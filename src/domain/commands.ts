import type { DiagnosticCommand } from './types';

export type InspectorCommand = DiagnosticCommand | { type: 'page-context' };
