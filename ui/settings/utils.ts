/*
 * [INPUT]: 条件类名与 Tailwind 工具类。
 * [OUTPUT]: cn 合并条件类名，并让后传入的冲突工具类优先。
 * [POS]: 设置页组件的类名工具。
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。
 */
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
