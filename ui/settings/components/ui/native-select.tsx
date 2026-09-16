/*
 * [INPUT]: React 属性、Tailwind 语义变量与 cn 类名合并。
 * [OUTPUT]: 可复用设置页控件；基于 shadcn/ui 定制，许可见 LICENSE。
 * [POS]: Web 设置页基础组件，不用于宿主注入。
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。
 */
import * as React from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/utils';
import { inputStyles } from './input';
export function NativeSelect({ className, ...props }: React.ComponentProps<'select'>) {
  return (
    <div className="relative w-full">
      <select
        data-slot="native-select"
        className={cn(inputStyles, 'appearance-none pr-8', className)}
        {...props}
      />
      <ChevronDown
        aria-hidden="true"
        className="pointer-events-none absolute right-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
      />
    </div>
  );
}
