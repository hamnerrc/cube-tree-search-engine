
const solverPromise = new Promise(resolve => {
	self.Module = {
		onRuntimeInitialized: () => resolve(self.Module),
		locateFile: (path, prefix) => prefix + path + (self.location.search || ''),
	};
});

importScripts('pseudo.js' + (self.location.search || ''));

self.onmessage = async function (event) {
	const { scr, rot, slot, pslot, num, len, move_restrict, post_alg, center_offset, max_rot_count, ma2, mcString, noopMoves, deadline } = event.data;
	try {
		const Module = await solverPromise;
		if (typeof Module.setNoopMoves === 'function') Module.setNoopMoves(noopMoves || '');
		Module._deadline = deadline || 0;
		if (typeof Module.setDeadlineCheck === 'function') Module.setDeadlineCheck(!!deadline);
		Module.solve(scr, rot, slot, pslot, num, len, move_restrict, post_alg, center_offset, max_rot_count, ma2, mcString);
	} catch (e) {
		self.postMessage("Error");
	}
};