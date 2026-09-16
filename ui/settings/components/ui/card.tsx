/*
 * [INPUT]: React 属性、Tailwind 语义变量与 cn 类名合并。
 * [OUTPUT]: 可复用设置页控件；基于 shadcn/ui 定制，许可见 LICENSE。
 * [POS]: Web 设置页基础组件，不用于宿主注入。
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。
 */
import * as React from 'react';
import { cn } from '@/utils';
export function Card({ className, ...props }: React.ComponentProps<'section'>) {
  return (
    <section
      data-slot="card"
      className={cn(
        'mb-[18px] rounded-2xl border border-border bg-card p-[25px] text-card-foreground shadow-[0_3px_6px_#00000001] max-[850px]:p-5 max-[650px]:rounded-[13px]',
        className,
      )}
      {...props}
    />
  );
}
