/*
 * [INPUT]: React 属性、Tailwind 语义变量与 cn 类名合并。
 * [OUTPUT]: 可复用设置页控件；基于 shadcn/ui 定制，许可见 LICENSE。
 * [POS]: Web 设置页基础组件，不用于宿主注入。
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。
 */
import * as React from 'react';
import * as SwitchPrimitive from '@radix-ui/react-switch';
import { cn } from '@/utils';
export function Switch({ className, ...props }: React.ComponentProps<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      className={cn(
        'inline-flex h-[21px] w-[34px] shrink-0 items-center rounded-full border-0 p-0 transition-colors data-[state=checked]:bg-primary data-[state=unchecked]:bg-switch-track focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-3 disabled:opacity-45',
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className="pointer-events-none block size-[17px] rounded-full bg-white shadow-[0_1px_3px_#0002] transition-transform data-[state=checked]:translate-x-[15px] data-[state=unchecked]:translate-x-[2px]"
      />
    </SwitchPrimitive.Root>
  );
}
