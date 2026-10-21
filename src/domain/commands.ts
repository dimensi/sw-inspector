import type { ManifestCommand } from '../manifest/types';
import type { ControlCommand } from './actions';
import type { DiagnosticCommand } from './types';

export type InspectorCommand = DiagnosticCommand | { type: 'page-context' } | ControlCommand | ManifestCommand;
