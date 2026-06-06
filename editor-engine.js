/* Keymap editor engine: pure, DOM-free, testable with node.

   Parses the raw .keymap (no preprocessing, no comment stripping) and records the
   character span of each binding token. An edit rewrites only the target token's span
   and leaves the rest of the file (comments, whitespace, behaviors, combos, #includes)
   untouched, so the file is never regenerated wholesale.

   The manual UI, AI editor, layer/combo/behavior authoring and download all build on
   this. */
(function (root) {
  'use strict';

  // Display-friendly layer name from a node name (e.g. "lower_layer" -> "Lower").
  function fmtName(n) {
    return n.replace(/_layer$/i, '').replace(/_/g, ' ')
            .replace(/\b\w/g, c => c.toUpperCase()).trim() || n;
  }

  // Walk from `from` (the index of a character just after an opening "{") to the
  // matching "}", honouring // and /* */ comments and "…"/'…' strings so braces
  // inside them don't throw off the depth count. Returns the index of the
  // matching close brace, or -1.
  function matchBrace(text, from) {
    let depth = 1, i = from;
    while (i < text.length) {
      const c = text[i], c2 = text[i + 1];
      if (c === '/' && c2 === '/') { i += 2; while (i < text.length && text[i] !== '\n') i++; continue; }
      if (c === '/' && c2 === '*') { i += 2; while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i++; i += 2; continue; }
      if (c === '"' || c === "'") { const q = c; i++; while (i < text.length && text[i] !== q) { if (text[i] === '\\') i++; i++; } i++; continue; }
      if (c === '{') depth++;
      else if (c === '}') { depth--; if (depth === 0) return i; }
      i++;
    }
    return -1;
  }

  // Tokenise a bindings block's inner content into &-prefixed tokens, recording
  // each token's absolute [start,end) offsets in the ORIGINAL text (base = the
  // offset of `content` within the file). Comment-aware so a stray "&" inside a
  // comment is never mistaken for a binding. Trailing whitespace is excluded
  // from a token's span so splicing preserves the surrounding layout.
  function tokenizeBindings(content, base) {
    const tokens = [];
    let i = 0, n = content.length, curStart = -1;
    const close = (end) => {
      if (curStart < 0) return;
      let e = end; while (e > curStart && /\s/.test(content[e - 1])) e--;
      tokens.push({ text: content.slice(curStart, e), start: base + curStart, end: base + e });
      curStart = -1;
    };
    while (i < n) {
      const c = content[i], c2 = content[i + 1];
      if (c === '/' && c2 === '/') { close(i); i += 2; while (i < n && content[i] !== '\n') i++; continue; }
      if (c === '/' && c2 === '*') { close(i); i += 2; while (i < n && !(content[i] === '*' && content[i + 1] === '/')) i++; i += 2; continue; }
      if (c === '&') { close(i); curStart = i; i++; continue; }
      i++;
    }
    close(n);
    return tokens;
  }

  // Find the end of a bindings block content that began at contentStart: the
  // index of the ">" that is followed by optional whitespace then ";". -1 if none.
  function findBindingsEnd(text, contentStart) {
    let from = contentStart;
    while (from < text.length) {
      const gt = text.indexOf('>', from);
      if (gt === -1) return -1;
      if (/^\s*;/.test(text.slice(gt + 1))) return gt;
      from = gt + 1;
    }
    return -1;
  }

  /* Parse the raw text into a document model.
     model = {
       text,                       // the original, verbatim
       layers: [{ name, displayName, contentStart, contentEnd, tokens:[{text,start,end}] }]
     }
     Only `bindings = <…>` blocks INSIDE the keymap{} node are treated as layers,
     so behaviors{}/combos{} bindings are correctly excluded. */
  function parseKeymap(text) {
    const model = { text, layers: [], keymap: null };
    const kmOpen = /\bkeymap\s*\{/.exec(text);
    if (!kmOpen) return model;
    const kmContentStart = kmOpen.index + kmOpen[0].length;
    const kmEnd = matchBrace(text, kmContentStart);
    if (kmEnd === -1) return model;
    model.keymap = { contentStart: kmContentStart, contentEnd: kmEnd };

    const re = /\bbindings\s*=\s*</g;
    re.lastIndex = kmContentStart;
    let m;
    while ((m = re.exec(text)) && m.index < kmEnd) {
      const contentStart = m.index + m[0].length;
      const contentEnd = findBindingsEnd(text, contentStart);
      if (contentEnd === -1 || contentEnd > kmEnd) continue;
      const tokens = tokenizeBindings(text.slice(contentStart, contentEnd), contentStart);
      // Enclosing node name = innermost "word {" with no closing "}" before our match.
      const before = text.slice(0, m.index);
      const nameM = before.match(/(\w+)\s*\{[^{}]*$/);
      const name = nameM ? nameM[1] : ('layer' + model.layers.length);
      if (name === 'keymap') continue;
      // Spans (for rename/remove): the node-name token, and the full "name { … };" node.
      let nameStart = -1, nameEnd = -1, nodeStart = -1, nodeEnd = -1;
      if (nameM) {
        nameStart = nameM.index;
        nameEnd = nameStart + nameM[1].length;
        const braceAbs = text.indexOf('{', nameEnd);
        const close = matchBrace(text, braceAbs + 1);
        let e = close + 1; const semi = text.slice(e).match(/^\s*;/); if (semi) e += semi[0].length;
        nodeStart = nameStart; nodeEnd = e;
      }
      model.layers.push({ name, displayName: fmtName(name), contentStart, contentEnd, tokens, nameStart, nameEnd, nodeStart, nodeEnd });
      re.lastIndex = contentEnd;
    }
    return model;
  }

  // Convenience: array of binding strings for a layer.
  function layerBindings(model, layerIdx) {
    return model.layers[layerIdx].tokens.map(t => t.text);
  }

  /* setBinding - the canonical edit op. Replace one key's binding by splicing
     ONLY that token's character span. Returns the new full text (caller
     re-parses). newBinding is a raw binding string e.g. "&kp ESC". */
  function setBinding(model, layerIdx, keyIdx, newBinding) {
    const layer = model.layers[layerIdx];
    if (!layer) throw new Error('no such layer ' + layerIdx);
    const tok = layer.tokens[keyIdx];
    if (!tok) throw new Error('no such key ' + keyIdx + ' on layer ' + layerIdx);
    return model.text.slice(0, tok.start) + newBinding.trim() + model.text.slice(tok.end);
  }

  /* Validate a setBinding result: re-parse and confirm we changed exactly the
     intended key and nothing structural - same layer count, same key counts.
     Returns { ok, errors:[] }. Richer keycode/arity checks can build on the keycode
     catalog later. */
  function validateSetBinding(beforeModel, afterText, layerIdx, keyIdx, newBinding) {
    const errors = [];
    const after = parseKeymap(afterText);
    if (after.layers.length !== beforeModel.layers.length)
      errors.push(`layer count changed (${beforeModel.layers.length} -> ${after.layers.length})`);
    beforeModel.layers.forEach((L, i) => {
      const A = after.layers[i];
      if (A && A.tokens.length !== L.tokens.length)
        errors.push(`layer "${L.name}" key count changed (${L.tokens.length} -> ${A.tokens.length})`);
    });
    const newTok = after.layers[layerIdx] && after.layers[layerIdx].tokens[keyIdx];
    if (newTok && newTok.text !== newBinding.trim())
      errors.push(`target key did not become "${newBinding.trim()}" (got "${newTok && newTok.text}")`);
    return { ok: errors.length === 0, errors };
  }

  /* History - text-snapshot undo/redo. Simple and robust: the source text is the
     single source of truth, so snapshotting it captures every edit exactly. */
  class History {
    constructor(text) { this.stack = [text]; this.idx = 0; }
    get current() { return this.stack[this.idx]; }
    push(text) {
      if (text === this.current) return;
      this.stack = this.stack.slice(0, this.idx + 1);
      this.stack.push(text); this.idx = this.stack.length - 1;
    }
    canUndo() { return this.idx > 0; }
    canRedo() { return this.idx < this.stack.length - 1; }
    undo() { if (this.canUndo()) this.idx--; return this.current; }
    redo() { if (this.canRedo()) this.idx++; return this.current; }
  }

  // Find the inner content span of the first block matching openRe (e.g.
  // /\bbehaviors\s*\{/). contentEnd is the index of the matching "}". null if none.
  function findBlock(text, openRe) {
    openRe.lastIndex = 0;
    const m = openRe.exec(text);
    if (!m) return null;
    const contentStart = m.index + m[0].length;
    const end = matchBrace(text, contentStart);
    if (end === -1) return null;
    return { openIndex: m.index, contentStart, contentEnd: end };
  }

  // Insert `node` (a child node string, already indented, no surrounding newlines)
  // just before the line that holds the block's closing brace at closeIdx. Keeps the
  // closing brace's own indentation intact, so inserts are correctly formatted AND
  // exactly reversible by the matching remove.
  function insertBeforeClose(text, closeIdx, node) {
    const lineStart = text.lastIndexOf('\n', closeIdx - 1) + 1;
    return text.slice(0, lineStart) + node + '\n' + text.slice(lineStart);
  }

  // Build a behaviors{} child node (string) from a spec. Verified against ZMK docs:
  //  mod-morph: keep-mods defaults to 0 (masks the listed mods) → clean morphed output.
  //  hold-tap : #binding-cells <2>, used as `&name HOLD TAP`.
  //  tap-dance: #binding-cells <0>.
  function behaviorNode(spec) {
    const I = '        ', I2 = '            ';
    const head = `${I}${spec.name}: ${spec.name} {\n`, foot = `${I}};`;
    let body;
    if (spec.type === 'mod-morph') {
      body = `${I2}compatible = "zmk,behavior-mod-morph";\n`
           + `${I2}#binding-cells = <0>;\n`
           + `${I2}bindings = <${spec.bindings[0]}>, <${spec.bindings[1]}>;\n`
           + `${I2}mods = <(${spec.mods.join('|')})>;\n`;
    } else if (spec.type === 'hold-tap') {
      body = `${I2}compatible = "zmk,behavior-hold-tap";\n`
           + `${I2}#binding-cells = <2>;\n`
           + `${I2}flavor = "${spec.flavor || 'tap-preferred'}";\n`
           + `${I2}tapping-term-ms = <${spec.tappingTermMs || 200}>;\n`
           + `${I2}bindings = <${spec.bindings[0]}>, <${spec.bindings[1]}>;\n`;
    } else if (spec.type === 'tap-dance') {
      body = `${I2}compatible = "zmk,behavior-tap-dance";\n`
           + `${I2}#binding-cells = <0>;\n`
           + `${I2}tapping-term-ms = <${spec.tappingTermMs || 200}>;\n`
           + `${I2}bindings = ${spec.bindings.map(b => `<${b}>`).join(', ')};\n`;
    } else throw new Error('unknown behavior type ' + spec.type);
    return head + body + foot;
  }

  // Insert a behavior node, round-trip-safe. Into the existing behaviors{} block
  // if present (before its "}"), else create a behaviors{} inside the root "/ {".
  // Returns the new full text.
  function addBehavior(model, spec) {
    const text = model.text;
    const node = behaviorNode(spec);
    const beh = findBlock(text, /\bbehaviors\s*\{/g);
    if (beh) return insertBeforeClose(text, beh.contentEnd, node);
    const root = findBlock(text, /\/\s*\{/g);
    if (!root) throw new Error('no root devicetree node ("/ {") found');
    const block = `\n    behaviors {\n${node}\n    };\n`;
    return text.slice(0, root.contentStart) + block + text.slice(root.contentStart);
  }

  // Validate a new behavior name: a C identifier not already used as a label.
  function behaviorNameError(model, name) {
    if (!/^[A-Za-z_]\w*$/.test(name)) return 'Use letters, numbers and underscores; don’t start with a number.';
    if (new RegExp('\\b' + name + '\\s*:').test(model.text)) return `A behaviour/label named "${name}" already exists.`;
    return null;
  }

  // Append a new empty layer (all &trans) at the end of keymap{}. keyCount defaults
  // to the first layer's size. Safe: it's the new highest index, so no existing layer
  // reference changes meaning. Returns new text.
  function addLayer(model, name, keyCount) {
    if (!model.keymap) throw new Error('no keymap{} node found');
    const safe = String(name || '').trim();
    if (!/^[A-Za-z_]\w*$/.test(safe)) throw new Error('Layer name must be letters/numbers/underscore and not start with a number.');
    if (model.layers.some(L => L.name === safe)) throw new Error('A layer named "' + safe + '" already exists.');
    const n = keyCount || (model.layers[0] ? model.layers[0].tokens.length : 0);
    const per = 10, lines = [];
    for (let i = 0; i < n; i += per) lines.push('                ' + Array(Math.min(per, n - i)).fill('&trans').join(' '));
    const body = n ? ('\n' + lines.join('\n') + '\n            ') : '';
    const node = `        ${safe} {\n            bindings = <${body}>;\n        };`;
    return insertBeforeClose(model.text, model.keymap.contentEnd, node);
  }

  // Rename a layer's node. Cosmetic only - ZMK layer references are by index, not
  // name - so no renumbering is needed. Returns new text.
  function renameLayer(model, idx, newName) {
    const L = model.layers[idx];
    if (!L || L.nameStart < 0) throw new Error('layer not found / has no name span');
    const safe = String(newName || '').trim();
    if (!/^[A-Za-z_]\w*$/.test(safe)) throw new Error('Layer name must be letters/numbers/underscore and not start with a number.');
    if (model.layers.some((o, i) => i !== idx && o.name === safe)) throw new Error('A layer named "' + safe + '" already exists.');
    return model.text.slice(0, L.nameStart) + safe + model.text.slice(L.nameEnd);
  }

  // ── Layer reorder / delete (with reference renumbering) ──────────────────
  // ZMK references layers by INDEX, so moving or deleting a layer must rewrite
  // every reference: &mo/&to/&tog/&sl/&lt bindings, combo `layers`, conditional
  // `if-layers`/`then-layer`, and `#define NAME <n>` layer constants. `remap` maps
  // an OLD layer index to its NEW index, or null if that layer was deleted.

  // Map of #define names → value, restricted to those actually USED as a layer ref
  // (so unrelated numeric #defines like TAPPING_TERM are never touched).
  function layerDefineMap(text) {
    const all = {}; let m;
    const defRe = /#define\s+([A-Za-z_]\w*)\s+(\d+)\b/g;
    while ((m = defRe.exec(text))) all[m[1]] = parseInt(m[2], 10);
    const used = new Set();
    const refRe = /&(?:mo|to|tog|sl|lt)\s+([A-Za-z_]\w*)/g;
    while ((m = refRe.exec(text))) used.add(m[1]);
    const listRe = /(?:layers|if-layers|then-layer)\s*=\s*<([^>]*)>/g;
    while ((m = listRe.exec(text)))
      m[1].trim().split(/\s+/).forEach(t => { if (/^[A-Za-z_]\w*$/.test(t)) used.add(t); });
    const map = {};
    for (const k in all) if (used.has(k)) map[k] = all[k];
    return map;
  }

  function applyLayerRemap(text, remap) {
    const dmap = layerDefineMap(text);
    const resolve = tok => /^\d+$/.test(tok) ? parseInt(tok, 10) : (tok in dmap ? dmap[tok] : null);
    // &lt LAYER KEY  (two args - only the first is a layer)
    text = text.replace(/&lt\s+([A-Za-z_]\w*|\d+)\s+([^\s>]+)/g, (full, lay, key) => {
      const idx = resolve(lay); if (idx == null) return full;
      const ni = remap(idx);
      if (ni == null) return '&none';
      return /^\d+$/.test(lay) ? `&lt ${ni} ${key}` : full;
    });
    // &mo/&to/&tog/&sl LAYER  (one arg)
    text = text.replace(/&(mo|to|tog|sl)\s+([A-Za-z_]\w*|\d+)/g, (full, beh, lay) => {
      const idx = resolve(lay); if (idx == null) return full;
      const ni = remap(idx);
      if (ni == null) return '&none';
      return /^\d+$/.test(lay) ? `&${beh} ${ni}` : full;
    });
    // list properties: layers / if-layers / then-layer - remap tokens, drop deleted;
    // remove the whole property line if it becomes empty.
    text = text.replace(/(\n[ \t]*)(layers|if-layers|then-layer)(\s*=\s*)<([^>]*)>(\s*;)/g,
      (full, pre, prop, eq, list, semi) => {
        const toks = list.trim().length ? list.trim().split(/\s+/) : [];
        const out = [];
        for (const t of toks) {
          const idx = resolve(t);
          if (idx == null) { out.push(t); continue; }
          const ni = remap(idx);
          if (ni == null) continue;
          out.push(/^\d+$/.test(t) ? String(ni) : t);
        }
        return out.length ? `${pre}${prop}${eq}<${out.join(' ')}>${semi}` : '';
      });
    // layer #define values - remap; drop the define if its layer was deleted.
    text = text.replace(/(\n[ \t]*)?#define\s+([A-Za-z_]\w*)\s+(\d+)\b([^\n]*)/g,
      (full, pre, name, num, rest) => {
        if (!(name in dmap)) return full;
        const ni = remap(parseInt(num, 10));
        if (ni == null) return '';
        return `${pre || ''}#define ${name} ${ni}${rest || ''}`;
      });
    return text;
  }

  // Each layer's full text block including its leading indentation.
  function layerBlocks(model) {
    const t = model.text;
    return model.layers.map(L => {
      const lineStart = t.lastIndexOf('\n', L.nodeStart - 1) + 1;
      return { lineStart, nodeEnd: L.nodeEnd, text: t.slice(lineStart, L.nodeEnd) };
    });
  }

  // Rebuild the layer region in the order given by `seq` (array of OLD indices).
  // Omitting an index deletes that layer's node. Preserves the inter-layer separator.
  function reorderLayerNodes(model, seq) {
    const t = model.text, blocks = layerBlocks(model);
    const first = blocks[0], last = blocks[blocks.length - 1];
    let sep = '\n\n';
    if (blocks.length >= 2) sep = t.slice(blocks[0].nodeEnd, blocks[1].lineStart);
    const region = seq.map(o => blocks[o].text).join(sep);
    return t.slice(0, first.lineStart) + region + t.slice(last.nodeEnd);
  }

  // Count binding references (&mo/&to/&tog/&sl/&lt) pointing at a layer - for the
  // "N keys point to this layer" delete warning.
  function countLayerRefs(model, idx) {
    const text = model.text, dmap = layerDefineMap(text);
    const resolve = tok => /^\d+$/.test(tok) ? parseInt(tok, 10) : (tok in dmap ? dmap[tok] : null);
    let count = 0, m;
    const re = /&(?:mo|to|tog|sl)\s+([A-Za-z_]\w*|\d+)|&lt\s+([A-Za-z_]\w*|\d+)\s+[^\s>]+/g;
    while ((m = re.exec(text))) { if (resolve(m[1] || m[2]) === idx) count++; }
    return count;
  }

  function moveLayer(model, from, to) {
    const n = model.layers.length;
    if (from < 0 || from >= n || to < 0 || to >= n || from === to) return model.text;
    const order = []; for (let i = 0; i < n; i++) order.push(i);
    order.splice(from, 1); order.splice(to, 0, from);
    const text2 = reorderLayerNodes(model, order);
    return applyLayerRemap(text2, o => order.indexOf(o));
  }

  function deleteLayer(model, idx) {
    const n = model.layers.length;
    if (idx < 0 || idx >= n) throw new Error('layer out of range');
    if (n <= 1) throw new Error('cannot delete the only layer');
    const seq = []; for (let i = 0; i < n; i++) if (i !== idx) seq.push(i);
    const text2 = reorderLayerNodes(model, seq);
    return applyLayerRemap(text2, o => o === idx ? null : seq.indexOf(o));
  }

  // ── Combos ──────────────────────────────────────────────────────────────
  // Parse the combos{} block into child nodes with spans + fields.
  function parseCombos(model) {
    const text = model.text;
    const blk = findBlock(text, /\bcombos\s*\{/g);
    const out = { block: blk ? { contentStart: blk.contentStart, contentEnd: blk.contentEnd } : null, combos: [] };
    if (!blk) return out;
    const re = /(\w+)\s*\{/g; re.lastIndex = blk.contentStart;
    let m;
    while ((m = re.exec(text)) && m.index < blk.contentEnd) {
      const name = m[1];
      const braceAbs = m.index + m[0].length - 1;
      const close = matchBrace(text, braceAbs + 1);
      if (close === -1 || close > blk.contentEnd) break;
      const body = text.slice(braceAbs + 1, close);
      const pos = (body.match(/key-positions\s*=\s*<([^>]*)>/) || [])[1];
      const bnd = (body.match(/bindings\s*=\s*<([^>]*)>/) || [])[1];
      const lay = (body.match(/layers\s*=\s*<([^>]*)>/) || [])[1];
      const semi = text.slice(close + 1).match(/^\s*;/);
      out.combos.push({
        name, nodeStart: m.index, nodeEnd: close + 1 + (semi ? semi[0].length : 0),
        positions: pos ? pos.trim().split(/\s+/).map(Number) : [],
        binding: bnd ? ('&' + bnd.trim().replace(/^&/, '')) : '',
        layers: lay ? lay.trim().split(/\s+/).map(Number) : null,
      });
      re.lastIndex = close + 1;
    }
    return out;
  }

  function comboNode(spec) {
    const I = '        ', I2 = '            ';
    let body = `${I2}timeout-ms = <${spec.timeoutMs || 50}>;\n`
             + `${I2}key-positions = <${spec.keyPositions.join(' ')}>;\n`
             + `${I2}bindings = <${spec.binding}>;\n`;
    if (spec.layers && spec.layers.length) body += `${I2}layers = <${spec.layers.join(' ')}>;\n`;
    return `${I}${spec.name} {\n${body}${I}};`;
  }

  // Insert a combo, round-trip-safe: into combos{} if present, else create it in root.
  function addCombo(model, spec) {
    const text = model.text, node = comboNode(spec);
    const c = findBlock(text, /\bcombos\s*\{/g);
    if (c) return insertBeforeClose(text, c.contentEnd, node);
    const root = findBlock(text, /\/\s*\{/g);
    if (!root) throw new Error('no root devicetree node ("/ {") found');
    const block = `\n    combos {\n        compatible = "zmk,combos";\n${node}\n    };\n`;
    return text.slice(0, root.contentStart) + block + text.slice(root.contentStart);
  }

  function removeCombo(model, idx) {
    const c = parseCombos(model).combos[idx];
    if (!c) throw new Error('combo not found');
    let s = c.nodeStart;
    while (s > 0 && (model.text[s - 1] === ' ' || model.text[s - 1] === '\t')) s--;
    if (model.text[s - 1] === '\n') s--;   // swallow one preceding blank line
    return model.text.slice(0, s) + model.text.slice(c.nodeEnd);
  }

  function comboNameError(model, name) {
    if (!/^[A-Za-z_]\w*$/.test(name)) return 'Use letters, numbers and underscores; don’t start with a number.';
    if (parseCombos(model).combos.some(c => c.name === name)) return `A combo named "${name}" already exists.`;
    return null;
  }

  function parseConditionalLayers(model) {
    const text = model.text;
    const blk = findBlock(text, /\bconditional_layers\s*\{/g);
    const out = { block: blk ? { contentStart: blk.contentStart, contentEnd: blk.contentEnd } : null, conds: [] };
    if (!blk) return out;
    const re = /(\w+)\s*\{/g; re.lastIndex = blk.contentStart;
    let m;
    while ((m = re.exec(text)) && m.index < blk.contentEnd) {
      const name = m[1];
      const braceAbs = m.index + m[0].length - 1;
      const close = matchBrace(text, braceAbs + 1);
      if (close === -1 || close > blk.contentEnd) break;
      const body = text.slice(braceAbs + 1, close);
      const ifs = (body.match(/if-layers\s*=\s*<([^>]*)>/) || [])[1];
      const then = (body.match(/then-layer\s*=\s*<\s*(\d+)\s*>/) || [])[1];
      const semi = text.slice(close + 1).match(/^\s*;/);
      if (ifs != null && then != null) out.conds.push({
        name, nodeStart: m.index, nodeEnd: close + 1 + (semi ? semi[0].length : 0),
        ifLayers: ifs.trim().split(/\s+/).map(Number).filter(n => !isNaN(n)),
        thenLayer: parseInt(then, 10),
      });
      re.lastIndex = close + 1;
    }
    return out;
  }

  function conditionalNode(spec) {
    const I = '        ', I2 = '            ';
    const body = `${I2}if-layers = <${spec.ifLayers.join(' ')}>;\n`
               + `${I2}then-layer = <${spec.thenLayer}>;\n`;
    return `${I}${spec.name} {\n${body}${I}};`;
  }

  // Insert a conditional layer, round-trip-safe: into conditional_layers{} if present,
  // else create that node in root.
  function addConditionalLayer(model, spec) {
    const text = model.text, node = conditionalNode(spec);
    const c = findBlock(text, /\bconditional_layers\s*\{/g);
    if (c) return insertBeforeClose(text, c.contentEnd, node);
    const root = findBlock(text, /\/\s*\{/g);
    if (!root) throw new Error('no root devicetree node ("/ {") found');
    const block = `\n    conditional_layers {\n        compatible = "zmk,conditional-layers";\n${node}\n    };\n`;
    return text.slice(0, root.contentStart) + block + text.slice(root.contentStart);
  }

  function removeConditionalLayer(model, idx) {
    const c = parseConditionalLayers(model).conds[idx];
    if (!c) throw new Error('conditional layer not found');
    let s = c.nodeStart;
    while (s > 0 && (model.text[s - 1] === ' ' || model.text[s - 1] === '\t')) s--;
    if (model.text[s - 1] === '\n') s--;
    return model.text.slice(0, s) + model.text.slice(c.nodeEnd);
  }

  function conditionalNameError(model, name) {
    if (!/^[A-Za-z_]\w*$/.test(name)) return 'Use letters, numbers and underscores; don’t start with a number.';
    if (parseConditionalLayers(model).conds.some(c => c.name === name)) return `A conditional layer named "${name}" already exists.`;
    return null;
  }

  const api = { parseKeymap, layerBindings, setBinding, validateSetBinding, History,
                findBlock, behaviorNode, addBehavior, behaviorNameError, addLayer, renameLayer,
                moveLayer, deleteLayer, countLayerRefs, applyLayerRemap,
                parseCombos, comboNode, addCombo, removeCombo, comboNameError,
                parseConditionalLayers, conditionalNode, addConditionalLayer, removeConditionalLayer, conditionalNameError,
                _internal: { tokenizeBindings, matchBrace, findBindingsEnd, fmtName } };

  if (typeof module !== 'undefined' && module.exports) module.exports = api; // node
  else root.KeymapEngine = api;                                             // browser
})(typeof globalThis !== 'undefined' ? globalThis : this);
