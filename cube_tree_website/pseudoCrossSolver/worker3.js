
const solverPromise = new Promise(resolve => {
	self.Module = {
		onRuntimeInitialized: () => resolve(self.Module),
		// cube-tree modification: forward the engine version query string so
		// a cached older pseudo.wasm is never used.
		locateFile: (path, prefix) => prefix + path + (self.location.search || ''),
	};
});

importScripts('pseudo.js' + (self.location.search || ''));

self.onmessage = async function (event) {
	const { scr, rot, slot, pslot, num, len, move_restrict, post_alg, center_offset, max_rot_count, ma2, mcString, noopMoves } = event.data;
	try {
		const Module = await solverPromise;
		// cube-tree modification: per-call no-op move set, reset every call.
		if (typeof Module.setNoopMoves === 'function') Module.setNoopMoves(noopMoves || '');
		Module.solve(scr, rot, slot, pslot, num, len, move_restrict, post_alg, center_offset, max_rot_count, ma2, mcString);
	} catch (e) {
		self.postMessage("Error");
	}
};