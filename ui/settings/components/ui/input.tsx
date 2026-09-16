/*
 * [INPUT]: React 属性、Tailwind 语义变量与 cn 类名合并。
 * [OUTPUT]: 可复用设置页控件；基于 shadcn/ui 定制，许可见 LICENSE。
 * [POS]: Web 设置页基础组件，不用于宿主注入。
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。
 */
import * as React from 'react';
import { cn } from '@/utils';
export const inputStyles =
  'h-[39px] w-full min-w-0 rounded-lg border border-border bg-input px-[11px] py-0 text-xs text-foreground transition-colors hover:border-ring/50 placeholder:text-muted-foreground placeholder:opacity-80 focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-3 disabled:opacity-45 disabled:cursor-not-allowed';
export function Input({ className, type, ...props }: React.ComponentProps<'input'>) {
  return <input type={type} data-slot="input" className={cn(inputStyles, className)} {...props} />;
}
