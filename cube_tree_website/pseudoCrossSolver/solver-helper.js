/**
 * NOTE (2026-10-04): results are solved only up to one free trailing D turn;
 * see the header of ../solver-helper-node.js and alignPseudoAlg in
 * solver-bridge.js (PROJECT_STATUS.md §4.14).
 *
 * pseudoCrossSolver Web Helper - Promise-based API for Web Workers, mirroring
 * crossSolver/solver-helper.js's shape (and pseudoCrossSolver/solver-helper-
 * node.js's method signature) so solver-bridge.js can dispatch to either
 * engine uniformly.
 *
 * Wraps worker3.js (the vendored, unmodified or18/RubiksSolverDemo worker --
 * see PROJECT_STATUS.md's provenance notes), which is a much thinner worker
 * than crossSolver/worker-persistent.js: it has no `{type, data}` message
 * envelope, because in a real Worker, pseudo.cpp's EM_JS-bound postMessage
 * call IS the native `self.postMessage` already (unlike Node, which has no
 * such global and needs one shimmed -- see solver-helper-node.js). So this
 * class listens for the SAME raw strings ("Search finished.", a solution
 * line, "depth=N", "Error...") that solver-helper-node.js's `_doSolve`
 * intercepts, not wrapped objects.
 *
 * No persistent prune-table reuse (see PROJECT_STATUS.md roadmap item 4 and
 * solver-helper-node.js's header comment): every solvePseudo() call rebuilds
 * its own search tables from scratch inside the worker's single WASM
 * instance. A known, accepted perf gap, not a bug.
 *
 * @example
 * const helper = new PseudoSolverHelper();
 * await helper.init();
 * const sols = await helper.solvePseudo(scramble, ['FR'], ['BL'], { maxSolutions: 5 });
 */
class PseudoSolverHelper {
  /**
   * @param {string|null} [workerPath] - Explicit path to worker3.js.
   *   Defaults to auto-detected path relative to this script.
   */
  constructor(workerPath = null) {
    if (!workerPath) {
      let scriptUrl = null;
      if (typeof document !== 'undefined' && document.currentScript && document.currentScript.src) {
        scriptUrl = document.currentScript.src;
      } else if (typeof document !== 'undefined') {
        const scripts = document.getElementsByTagName('script');
        for (let i = 0; i < scripts.length; i++) {
          if (scripts[i].src && scripts[i].src.includes('pseudoCrossSolver/solver-helper.js')) {
            scriptUrl = scripts[i].src;
            break;
          }
        }
      }
      if (scriptUrl) {
        const lastSlash = scriptUrl.lastIndexOf('/');
        const baseUrl = scriptUrl.substring(0, lastSlash + 1);
        this.workerPath = baseUrl + 'worker3.js';
      } else {
        this.workerPath = './worker3.js';
      }
    } else {
      this.workerPath = workerPath;
    }

    this._worker = null;
    this._ready = false;
    this._resolve = null;
    this._reject = null;
    this._solutions = [];
  }

  /**
   * Initialize (load) the worker. Safe to call multiple times.
   * @returns {Promise<void>}
   */
  init() {
    if (this._ready) return Promise.resolve();
    return new Promise((resolve, reject) => {
      try {
        this._worker = new Worker(this.workerPath);
        this._worker.onmessage = (event) => this._handleMessage(event.data);
        this._worker.onerror = (err) => {
          if (this._reject) {
            this._reject(err);
            this._clearState();
          } else {
            reject(err);
          }
        };
        this._ready = true;
        resolve();
      } catch (e) {
        reject(e);
      }
    });
  }

  terminate() {
    if (this._worker) {
      this._worker.terminate();
      this._worker = null;
      this._ready = false;
      this._clearState();
    }
  }

  /** @returns {boolean} */
  isReady() { return this._ready; }

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
   * Same contract as solver-helper-node.js's solvePseudo (see its JSDoc).
   * @returns {Promise<string[]>}
   */
  solvePseudo(scramble, edgeSlots, cornerSlots, options = {}) {
    this._assertReady();
    if (this._resolve) {
      return Promise.reject(new Error('Another solve is in progress.'));
    }
    if (edgeSlots.length !== cornerSlots.length) {
      return Promise.reject(new Error(`edgeSlots/cornerSlots length mismatch: ${edgeSlots.length} vs ${cornerSlots.length}`));
    }
    if (edgeSlots.length < 1 || edgeSlots.length > 3) {
      return Promise.reject(new Error(`pseudoCrossSolver only supports 1-3 pairs, got ${edgeSlots.length}`));
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

    // cube-tree modification: a call queued past its deadline is skipped (PROJECT_STATUS §4.36).
    if (options.deadline && Date.now() >= options.deadline) return Promise.resolve([]);
    this._solutions = [];

    return new Promise((resolve, reject) => {
      this._resolve = resolve;
      this._reject = reject;
      this._worker.postMessage({
        scr: scramble,
        rot: rotation,
        slot: edgeSlots.join(' '),
        pslot: cornerSlots.join(' '),
        num: maxSolutions,
        len: maxLength,
        move_restrict: this._restStr(allowedMoves),
        post_alg: postAlg,
        center_offset: this._centerOffsetStr(centerOffset),
        max_rot_count: maxRotCount,
        ma2,
        mcString: moveCount,
        noopMoves: options.noopMoves ? this._restStr(options.noopMoves) : '', // cube-tree modification
        deadline: options.deadline || 0, // cube-tree modification: epoch ms, see worker3.js
      });
    });
  }

  /** @private Dispatch raw string messages posted by worker3.js. */
  _handleMessage(msg) {
    if (typeof msg !== 'string') return;
    if (msg === 'Search finished.' || msg === 'Already solved.') {
      if (this._resolve) {
        this._resolve(this._solutions);
        this._clearState();
      }
      return;
    }
    if (msg === 'Search cancelled.') {
      if (this._resolve) {
        this._resolve(this._solutions);
        this._clearState();
      }
      return;
    }
    if (msg.startsWith('depth=')) return;
    if (msg.startsWith('Error')) {
      if (this._reject) {
        this._reject(new Error(msg));
        this._clearState();
      }
      return;
    }
    if (msg !== '') this._solutions.push(msg);
  }

  /** @private */
  _assertReady() {
    if (!this._ready) throw new Error('PseudoSolverHelper not initialized. Call init() first.');
  }

  /** @private */
  _clearState() {
    this._resolve = null;
    this._reject = null;
    this._solutions = [];
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = PseudoSolverHelper;
} else if (typeof window !== 'undefined') {
  window.PseudoSolverHelper = PseudoSolverHelper;
}
