/** Browser face of the installable ControlGUI plugin. */
import type { Context } from '@deepseek-ai/cordis'
import { installCodexGui } from './install.ts'

export const inject = ['slots', 'sidebarRight', 'sidebarRightTabs', 'sessions', 'commandUi']
export function apply(ctx: Context): void { installCodexGui(ctx) }
