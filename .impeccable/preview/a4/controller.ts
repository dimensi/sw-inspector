import { createActionController as real } from '../../../src/ui/action-controller.ts';
export type { ActionState } from '../../../src/ui/action-controller.ts';
export function createActionController(deps) { const controller = real(deps); window.a4controller = controller; return controller; }
