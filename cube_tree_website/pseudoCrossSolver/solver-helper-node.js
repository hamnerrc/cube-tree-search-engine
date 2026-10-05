/**
 * NOTE (2026-10-04): the engine's corner/edge targeting was once suspected
 * unreliable; that was a misreading. pseudo.cpp guarantees only "cross + the
 * targeted corners/edges solved UP TO ONE FREE TRAILING D TURN" (a D/D2/D'
 * brings all of them home at once). Callers must align that D -- see
 * alignPseudoAlg in solver-bridge.js and PROJECT_STATUS.md §4.14. Verified
 * 96/96 across 6 colors with real facelet replay.
 *
 * pseudoCrossSolver Node.js Helper - Promise-based API, mirroring
 * crossSolver/solver-helper-node.js's shape so solver-bridge.js can dispatch
 * to either engine uniformly, once the above is resolved.
 *
 * Unlike crossSolver, pseudo.cpp exposes a single free function
 * (`controller`, bound as `solve`) rather than a family of
 * Persistent*Solver classes -- there is no persistent prune-table reuse
 * here yet (see PROJECT_STATUS.md roadmap item 4: porting that pattern to
 * pseudo.cpp needs recompiling with emcc, not available in this
 * environment). Every solvePseudo() call rebuilds its own search tables
 * from scratch; this is a known, accepted perf gap, not a bug.
 *
 * `controller`'s `slot`/`pslot` strings are independent goal sets -- "slot"
 * (edges) and "pslot" (corners) name which EDGE-home-slots and
 * CORNER-home-slots must end up correctly placed, with no positional
 * pairing between the two lists (confirmed by reading F2L_option_array/
 * controller directly: slot_list2[i] and pslot_list2[i] are just the i-th
 * set bit of each independently-built boolean array, not matched by
 * intent). This is exactly what a genuine pseudo (mismatched) F2L edge
 * needs: e.g. corner home-slot FR + edge home-slot BL, placed together by
 * one algorithm, neither "belonging" to the other by color.
 *
 * Slot letter -> index mapping (BL=0, BR=1, FR=2, FL=3) confirmed by
 * directly reading F2L_option_array's string comparisons in pseudo.cpp --
 * identical to crossSolver's already-empirically-verified mapping (see
 * crossSolver/test/slot-mapping.test.js), but this is a DIFFERENT compiled
 * module, so it is re-verified for physical correctness (not just letter
 * parsing) in test/pseudo-slot-mapping.test.js rather than assumed.
 */
class PseudoSolverHelperNode {
  /**
   * @param {string} [pseudoJsPath] - Path to pseudo.js. Defaults to ./pseudo.js.
   * @param {string} [pseudoWasmPath] - Path to pseudo.wasm. Defaults to ./pseudo.wasm.
   */
  constructor(pseudoJsPath = null, pseudoWasmPath = null) {
    const path = require('path');
    this.pseudoJsPath = pseudoJsPath || path.join(__dirname, 'pseudo.js');
    this.pseudoWasmPath = pseudoWasmPath || path.join(__dirname, 'pseudo.wasm');
    this.Module = null;
    this.ready = false;
  }

  /**
   * Initialize the WASM module. Must be called once before solvePseudo().
   * @returns {Promise<void>}
   */
  async init() {
    if (this.ready) return;
    const fs = require('fs');
    if (!globalThis.postMessage) {
      globalThis.postMessage = () => {};
    }
    // pseudo.js (non-MODULARIZE build) picks up a pre-set globalThis.Module
    // as its init options and mutates/exports that same object -- this is
    // the pattern already proven against the real WASM binary in
    // cross_xcross.js / backend_test.js (see PROJECT_STATUS.md §3).
    globalThis.Module = {
      wasmBinary: fs.readFileSync(this.pseudoWasmPath),
      locateFile: (p) => (p.endsWith('.wasm') ? this.pseudoWasmPath : p),
      print: () => {},
      printErr: () => {},
    };
    this.Module = require(this.pseudoJsPath);
    while (typeof this.Module.solve !== 'function') {
      await new Promise((r) => setTimeout(r, 20));
    }
    this.ready = true;
  }

  /** @returns {boolean} true if init() has completed */
  isReady() { return this.ready; }

  _assertReady() {
    if (!this.ready) throw new Error('PseudoSolverHelperNode not initialized. Call init() first.');
  }

  /** Build the moves string accepted by C++ buidMoveRestrict(). */
  _restStr(allowedMoves) {
    if (!allowedMoves) return 'U_U2_U-_D_D2_D-_R_R2_R-_L_L2_L-_F_F2_F-_B_B2_B-';
    if (Array.isArray(allowedMoves)) {
      return allowedMoves.map((m) => m.replace(/'/g, '-')).join('_');
    }
    return String(allowedMoves);
  }

  /** Build the center_offset_string accepted by C++ buildCenterOffset(). */
  _centerOffsetStr(centerOffset) {
    if (centerOffset === null || centerOffset === undefined || centerOffset === '') {
      return 'EMPTY_EMPTY';
    }
    if (Array.isArray(centerOffset)) {
      return centerOffset.map((r) => {
        if (!r || r === '') return 'EMPTY_EMPTY';
        const parts = r.trim().split(/\s+/);
        const row = (parts[0] || 'EMPTY').replace(/'/g, '-');
        const col = (parts[1] || 'EMPTY').replace(/'/g, '-');
        return `${row}_${col}`;
      }).join('|');
    }
    return String(centerOffset);
  }

  /**
   * Solve a pseudo (independently-targeted edge/corner slot sets) F2L step.
   * @param {string} scramble
   * @param {string[]} edgeSlots - home-slots (subset of BL/BR/FR/FL) whose
   *   EDGE piece must end up correctly placed. 1-3 entries.
   * @param {string[]} cornerSlots - home-slots whose CORNER piece must end
   *   up correctly placed. Same length as edgeSlots; may name different
   *   slots than edgeSlots (that's the whole point of "pseudo").
   * @param {Object} [options]
   * @param {string}   [options.rotation='']
   * @param {number}   [options.maxSolutions=3]
   * @param {number}   [options.maxLength=12]
   * @param {string|string[]} [options.allowedMoves]
   * @param {string}   [options.postAlg='']
   * @param {string|string[]} [options.centerOffset='']
   * @param {number}   [options.maxRotCount=0]
   * @param {string}   [options.ma2='']
   * @param {string}   [options.moveCount='']
   * @returns {Promise<string[]>}
   */
  solvePseudo(scramble, edgeSlots, cornerSlots, options = {}) {
    this._assertReady();
    if (edgeSlots.length !== cornerSlots.length) {
      throw new Error(`edgeSlots/cornerSlots length mismatch: ${edgeSlots.length} vs ${cornerSlots.length}`);
    }
    if (edgeSlots.length < 1 || edgeSlots.length > 3) {
      throw new Error(`pseudoCrossSolver only supports 1-3 pairs, got ${edgeSlots.length}`);
    }
    const {
      rotation = '',
      maxSolutions = 3,
      maxLength = 12,
      allowedMoves = null,
      postAlg = '',
      centerOffset = '',
      maxRotCount = 0,
      ma2 = '',
      moveCount = '',
    } = options;

    const slot = edgeSlots.join(' ');
    const pslot = cornerSlots.join(' ');
    // cube-tree modification: a call queued past its deadline is skipped (PROJECT_STATUS §4.36).
    if (options.deadline && Date.now() >= options.deadline) return Promise.resolve([]);

    return this._doSolve(() => {
      // cube-tree modification: per-call no-op move set (pseudo.cpp
      // setNoopMoves); always reset so settings never leak between calls.
      if (typeof this.Module.setNoopMoves === 'function') {
        this.Module.setNoopMoves(options.noopMoves ? this._restStr(options.noopMoves) : '');
      }
      // cube-tree modification: per-call deadline (epoch ms, 0 = none),
      // checked inside the search (pseudo.cpp setDeadlineCheck, §4.36).
      this.Module._deadline = options.deadline || 0;
      if (typeof this.Module.setDeadlineCheck === 'function') this.Module.setDeadlineCheck(!!options.deadline);
      return this.Module.solve(
      scramble, rotation, slot, pslot, maxSolutions, maxLength,
      this._restStr(allowedMoves), postAlg,
      this._centerOffsetStr(centerOffset), maxRotCount, ma2, moveCount,
      );
    });
  }

  /**
   * Intercept globalThis.postMessage, call the solver, and return a Promise
   * that resolves with collected solutions on "Search finished." / cancel.
   * Same interception contract as crossSolver/solver-helper-node.js.
   */
  _doSolve(callFn) {
    const solutions = [];
    const origPostMessage = globalThis.postMessage;

    return new Promise((resolve, reject) => {
      globalThis.postMessage = (msg) => {
        if (msg === 'Search finished.' || msg === 'Already solved.') {
          globalThis.postMessage = origPostMessage;
          resolve(solutions);
        } else if (msg === 'Search cancelled.') {
          globalThis.postMessage = origPostMessage;
          resolve(solutions);
        } else if (typeof msg === 'string' && msg.startsWith('depth=')) {
          // no onProgress hook needed by this project's callers yet
        } else if (typeof msg === 'string' && msg.startsWith('Error')) {
          globalThis.postMessage = origPostMessage;
          reject(new Error(msg));
        } else if (msg !== '') {
          solutions.push(msg);
        }
      };
      try {
        callFn();
      } catch (e) {
        globalThis.postMessage = origPostMessage;
        reject(e);
      }
    });
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = PseudoSolverHelperNode;
}
