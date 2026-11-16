import type { Tool } from '../core/tool';
import { aiTool } from './ai';
import { apiTool } from './api';
import { commentsTool } from './comments';
import { consoleTool } from './console';
import { databaseTool } from './database';
import { homeTool } from './home';
import { multiplayerTool } from './multiplayer';
import { projectTool } from './project';
import { storageTool } from './storage';

/** Tools shown in the toolkit window, in tab order. */
export const tools: Tool[] = [
  homeTool,
  databaseTool,
  apiTool,
  multiplayerTool,
  aiTool,
  commentsTool,
  projectTool,
  consoleTool,
  storageTool,
];
