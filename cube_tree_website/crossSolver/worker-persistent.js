/**
 * crossSolver Persistent Worker - Web Worker wrapper
 *
 * Wraps all 8 PersistentSolver classes with a message-passing interface.
 * Uses MODULARIZE version (solver.js) for universal compatibility.
 * Same binary used in Node.js and Web Worker.
 *
 * Solver instances are lazily created and cached per (solverType, slots)
 * key so prune tables are reused across multiple solve calls.
 *
 * -------------------------------------------------------------------------
 * Message format (postMessage TO this worker):
 * -------------------------------------------------------------------------
 *
 *   // Solve request
 *   {
 *     type        : 'solve',
 *     solverType  : 'Cross' | 'Xcross' | 'Xxcross' | 'Xxxcross'
 *                 | 'Xxxxcross' | 'LLSubsteps' | 'LL' | 'LLAUF',
 *     scramble    : string,                (required)
 *     // Slot params (required for the respective solver types):
 *     slot        : number,                // Xcross   (0-3)
 *     slot1       : number,                // Xxcross, Xxxcross
 *     slot2       : number,                // Xxcross, Xxxcross
 *     slot3       : number,                // Xxxcross
 *     // LLSubsteps only:
 *     ll          : string | string[],     // e.g. 'CO EO' or ['CO','EO']
 *     // Common optional params:
 *     rotation    : string,                (default: '')
 *     maxSolutions: number,                (default: 3)
 *     maxLength   : number,                (solver-specific default)
 *     allowedMoves: string | string[],     (default: all 18 moves)
 *     postAlg     : string,                (default: '')
 *     centerOffset: string | string[],     (default: '')
 *     maxRotCount : number,                (default: 0)
 *     moveAfterMove: string,               (default: '')
 *     moveCount   : string,                (default: '')
 *   }
 *
 *   // Cancel current solve
 *   { type: 'cancel' }
 *
 * -------------------------------------------------------------------------
 * Response format (postMessage FROM this worker):
 * -------------------------------------------------------------------------
 *
 *   { type: 'solution',  data: string  }  // one solution string per message
 *   { type: 'depth',     data: string  }  // e.g. 'depth=5'
 *   { type: 'done',      data: null    }  // search finished normally
 *   { type: 'cancelled', data: null    }  // search cancelled
 *   { type: 'error',     data: string  }  // error message
 *   { type: 'ready',     data: null    }  // module loaded, ready to solve
 */

'use strict';

// ---- Module state --------------------------------------------------------
let wasmModule = null;
const _solvers = {};   // keyed by "Type:slot1:slot2:..."

// ---- Intercept postMessage from C++ -------------------------------------
const originalPostMessage = self.postMessage.bind(self);

// cube-tree modification (§4.40): a solve is running from its 'solve' message
// until the engine reports how it ended; table requests wait for that (the
// engine must not be re-entered while a search is paused at a yield).
let _solveBusy = false;
const _tableQueue = [];
function _solveEnded() {
  _solveBusy = false;
  // After the engine call has fully returned (this runs inside it).
  setTimeout(function() { while (!_solveBusy && _tableQueue.length) _handleTables(_tableQueue.shift()); }, 0);
}

// cube-tree modification: an engine failure (an Emscripten abort, e.g. memory
// growth failing) after a search has paused at a yield happens inside an
// Asyncify-resumed promise, outside the message handler's try/catch: the call
// never reported an end, so the page waited on it forever. Report it as a
// fatal error instead; the module may be corrupt after an abort, so every
// later solve is refused and the page replaces the worker.
let _broken = false;
function _fatal(what) {
  _broken = true;
  if (typeof _flushSolutions === 'function') _flushSolutions();
  if (_solveBusy) _solveEnded();
  originalPostMessage({ type: 'error', data: 'Engine failure: ' + what, fatal: true });
}
self.addEventListener('unhandledrejection', function(event) {
  event.preventDefault();
  var r = event.reason;
  _fatal((r && r.message) || String(r));
});

// cube-tree modification: solutions are sent in batches ({ type: 'solutions',
// data: [...] }), not one message each -- a complete search lists hundreds
// of thousands, and one page event per solution was most of a browser step.
// The batch is always flushed before any other message, so order is kept.
let _batch = [];
const BATCH_SIZE = 4096;
function _flushSolutions() {
  if (!_batch.length) return;
  originalPostMessage({ type: 'solutions', data: _batch });
  _batch = [];
}

globalThis.postMessage = function(message) {
  if (typeof message !== 'string') return;
  const isSolution = !(message === 'Search finished.' || message === 'Search cancelled.' || message === 'Already solved.'
    || message.startsWith('depth=') || message.startsWith('Error'));
  if (isSolution) {
    _batch.push(message);
    if (_batch.length >= BATCH_SIZE) _flushSolutions();
    return;
  }
  _flushSolutions();
  if (message === 'Search finished.' || message === 'Search cancelled.' || message === 'Already solved.' || message.startsWith('Error')) {
    _solveEnded();
  }
  if (message === 'Search finished.') {
    originalPostMessage({ type: 'done', data: null });
  } else if (message === 'Search cancelled.') {
    originalPostMessage({ type: 'cancelled', data: null });
  } else if (message === 'Already solved.') {
    originalPostMessage({ type: 'solution', data: '' });
    originalPostMessage({ type: 'done', data: null });
  } else if (message.startsWith('depth=')) {
    originalPostMessage({ type: 'depth', data: message });
  } else if (message.startsWith('Error')) {
    originalPostMessage({ type: 'error', data: message });
  } else {
    originalPostMessage({ type: 'solution', data: message });
  }
};

// ---- Load WASM module ----------------------------------------------------
const scriptPath = self.location.href;
const baseURL = scriptPath.substring(0, scriptPath.lastIndexOf('/') + 1);

// cube-tree modification: forward this worker's own query string (engine
// version) to solver.js and solver.wasm so cached old binaries are never used.
const engineQuery = self.location.search || '';

importScripts(baseURL + 'solver.js' + engineQuery);

createModule({
  locateFile: function(path) {
    if (path.endsWith('.wasm') || path.endsWith('.wasm.map')) {
      return baseURL + path + engineQuery;
    }
    return path;
  }
}).then(function(Module) {
  wasmModule = Module;
  originalPostMessage({ type: 'ready', data: null });
}).catch(function(err) {
  originalPostMessage({ type: 'error', data: 'Failed to initialize module: ' + err.message });
});

// ---- Internal helpers ----------------------------------------------------

/**
 * Get or create a cached solver instance.
 * @param {object} Module - the WASM Module
 * @param {string} type
 * @param {...number} slots
 */
function _getSolver(Module, type, ...slots) {
  const key = [type, ...slots].join(':');
  if (!_solvers[key]) {
    switch (type) {
      case 'Cross':      _solvers[key] = new Module.PersistentCrossSolver(); break;
      case 'Xcross':     _solvers[key] = new Module.PersistentXcrossSolver(slots[0]); break;
      case 'Xxcross':    _solvers[key] = new Module.PersistentXxcrossSolver(slots[0], slots[1]); break;
      case 'Xxxcross':   _solvers[key] = new Module.PersistentXxxcrossSolver(slots[0], slots[1], slots[2]); break;
      case 'Xxxxcross':  _solvers[key] = new Module.PersistentXxxxcrossSolver(); break;
      case 'LLSubsteps': _solvers[key] = new Module.PersistentLLSubstepsSolver(); break;
      case 'LL':         _solvers[key] = new Module.PersistentLLSolver(); break;
      case 'LLAUF':      _solvers[key] = new Module.PersistentLLAUFSolver(); break;
      default:
        throw new Error('Unknown solverType: ' + type);
    }
  }
  return _solvers[key];
}

/** Convert allowedMoves array/string → underscore-separated C++ format. */
function _restStr(allowedMoves) {
  if (!allowedMoves) return 'U_U2_U-_D_D2_D-_R_R2_R-_L_L2_L-_F_F2_F-_B_B2_B-';
  if (Array.isArray(allowedMoves)) {
    return allowedMoves.map(function(m) { return m.replace(/'/g, '-'); }).join('_');
  }
  return String(allowedMoves);
}

/** Convert centerOffset array/string → pipe-separated C++ format. */
function _centerOffsetStr(centerOffset) {
  if (centerOffset === null || centerOffset === undefined || centerOffset === '') {
    return 'EMPTY_EMPTY';
  }
  if (Array.isArray(centerOffset)) {
    return centerOffset.map(function(r) {
      if (!r || r === '') return 'EMPTY_EMPTY';
      var parts = r.trim().split(/\s+/);
      var row = (parts[0] || 'EMPTY').replace(/'/g, '-');
      var col = (parts[1] || 'EMPTY').replace(/'/g, '-');
      return row + '_' + col;
    }).join('|');
  }
  return String(centerOffset);
}

/** Normalize ll parameter → space-separated token string. */
function _llStr(ll) {
  if (!ll) return '';
  if (Array.isArray(ll)) return ll.join(' ');
  return String(ll);
}

// ---- Message handler -----------------------------------------------------

/** Answers one table request (see the 'tableKeys' message above). */
function _handleTables(data) {
  var M = wasmModule;

  var has = M && typeof M.tableCacheKeys === 'function';
  if (data.type === 'tableKeys') {
    originalPostMessage({ type: 'tableKeys', id: data.id, data: has ? M.tableCacheKeys() : '' });
  } else if (data.type === 'getTables') {
    var out = [];
    var buffers = [];
    (has ? data.keys || [] : []).forEach(function(key) {
      var view = M.tableCacheGet(key);
      if (view) { var copy = view.slice(); out.push({ key: key, data: copy }); buffers.push(copy.buffer); }
    });
    originalPostMessage({ type: 'tables', id: data.id, data: out }, buffers);
  } else {
    var put = 0;
    (has ? data.tables || [] : []).forEach(function(t) { if (M.tableCachePut(t.key, t.data)) put++; });
    originalPostMessage({ type: 'tablesPut', id: data.id, data: put });
  }
}

self.onmessage = async function(event) {
  try {
    var data = event.data;
    if (!data) return;

    // --- Cancel request ---
    if (data.type === 'cancel') {
      if (wasmModule) {
        wasmModule._cancelRequested = true;
      }
      return;
    }

    // cube-tree modification (PROJECT_STATUS.md §4.40): prune-table sharing.
    // tableKeys -> the engine's cached table keys; getTables {keys} -> copies
    // of those tables; putTables {tables} -> hand in tables built elsewhere
    // (the engine keeps only new keys of the right size). Replies carry the
    // request's id; an engine without the API answers with nothing.
    if (data.type === 'tableKeys' || data.type === 'getTables' || data.type === 'putTables') {
      if (_solveBusy) _tableQueue.push(data); else _handleTables(data);
      return;
    }

    if (data.type !== 'solve') return;

    if (_broken) {
      originalPostMessage({ type: 'error', data: 'Engine failure: worker needs a restart', fatal: true });
      return;
    }

    // --- Module ready check ---
    if (!wasmModule) {
      originalPostMessage({ type: 'error', data: 'Solver not initialized yet' });
      return;
    }

    var solverType = data.solverType;
    if (!solverType) {
      originalPostMessage({ type: 'error', data: 'solverType is required' });
      return;
    }

    var scramble = data.scramble;
    if (!scramble && scramble !== '') {
      originalPostMessage({ type: 'error', data: 'scramble is required' });
      return;
    }

    // Common params with defaults
    var rotation     = data.rotation     !== undefined ? String(data.rotation)     : '';
    var maxSolutions = data.maxSolutions !== undefined ? data.maxSolutions         : 3;
    var allowedMoves = _restStr(data.allowedMoves);
    var postAlg      = data.postAlg      !== undefined ? String(data.postAlg)      : '';
    var centerOffset = _centerOffsetStr(data.centerOffset);
    var maxRotCount  = data.maxRotCount  !== undefined ? data.maxRotCount          : 0;
    var moveAfterMove = data.moveAfterMove !== undefined ? String(data.moveAfterMove) : '';
    var moveCount    = data.moveCount    !== undefined ? String(data.moveCount)    : '';

    // Default maxLength per solver type
    var defaultMaxLength = {
      Cross: 8, Xcross: 10, Xxcross: 12, Xxxcross: 14,
      Xxxxcross: 16, LLSubsteps: 16, LL: 18, LLAUF: 20,
    };
    var maxLength = data.maxLength !== undefined ? data.maxLength : (defaultMaxLength[solverType] || 18);

    // Get/create solver instance (slot-keyed cache)
    var solver;
    switch (solverType) {
      case 'Xcross':
        solver = _getSolver(wasmModule, 'Xcross',   data.slot);
        break;
      case 'Xxcross':
        solver = _getSolver(wasmModule, 'Xxcross',  data.slot1, data.slot2);
        break;
      case 'Xxxcross':
        solver = _getSolver(wasmModule, 'Xxxcross', data.slot1, data.slot2, data.slot3);
        break;
      default:
        solver = _getSolver(wasmModule, solverType);
    }

    // cube-tree modification: moves allowed to leave every goal piece in
    // place (see solver.cpp setNoopMoves). Reset on every call so one
    // search's setting never leaks into the next.
    if (typeof wasmModule.setNoopMoves === 'function') {
      wasmModule.setNoopMoves(data.noopMoves ? _restStr(data.noopMoves) : '');
    }
    // cube-tree modification: per-call deadline (epoch ms, 0 = none) that the
    // engine checks itself (solver.cpp setDeadlineCheck, PROJECT_STATUS §4.36).
    wasmModule._deadline = data.deadline || 0;
    if (typeof wasmModule.setDeadlineCheck === 'function') {
      wasmModule.setDeadlineCheck(!!data.deadline);
    }

    // Call solve() with the correct argument list
    _solveBusy = true;
    if (solverType === 'LLSubsteps') {
      var ll = _llStr(data.ll);
      solver.solve(
        scramble, rotation, ll, maxSolutions, maxLength,
        allowedMoves, postAlg, centerOffset, maxRotCount, moveAfterMove, moveCount
      );
    } else {
      solver.solve(
        scramble, rotation, maxSolutions, maxLength,
        allowedMoves, postAlg, centerOffset, maxRotCount, moveAfterMove, moveCount
      );
    }

  } catch (e) {
    // A WebAssembly trap (abort, out of memory) leaves the module unusable.
    if (typeof WebAssembly !== 'undefined' && e instanceof WebAssembly.RuntimeError) { _fatal(e.message); return; }
    if (_solveBusy) _solveEnded();
    originalPostMessage({ type: 'error', data: e.message || 'Unknown worker error' });
  }
};
