/*
 * [INPUT]: React 属性、Tailwind 语义变量与 cn 类名合并。
 * [OUTPUT]: 语义设置分组，使用共用留白；基于 shadcn/ui 定制，许可见 LICENSE。
 * [POS]: Web 设置页基础组件，不用于宿主注入。
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。
 */
import * as React from 'react';
import { cn } from '@/utils';
export function Card({ className, ...props }: React.ComponentProps<'section'>) {
  return <section data-slot="card" className={cn('settings-section', className)} {...props} />;
}
