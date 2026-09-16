/*
 * [INPUT]: React 属性、Tailwind 语义变量与 cn 类名合并。
 * [OUTPUT]: 可复用设置页控件；基于 shadcn/ui 定制，许可见 LICENSE。
 * [POS]: Web 设置页基础组件，不用于宿主注入。
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。
 */
import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/utils';
const buttonVariants = cva(
  'inline-flex items-center justify-center gap-[7px] rounded-lg border text-[11px] font-medium whitespace-nowrap transition-colors cursor-pointer focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-3 disabled:opacity-45 disabled:cursor-not-allowed [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground border-primary enabled:hover:brightness-115',
        outline: 'bg-card text-foreground border-border enabled:hover:bg-accent',
        ghost:
          'bg-transparent border-transparent text-muted-foreground enabled:hover:text-foreground',
      },
      size: {
        default: 'min-h-[35px] px-[13px] py-2',
        icon: 'size-8 p-0 rounded-md',
        sm: 'min-h-0 px-2 py-[7px] text-[10px] rounded-[5px]',
      },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  },
);
function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: React.ComponentProps<'button'> & VariantProps<typeof buttonVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot : 'button';
  return (
    <Comp
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  );
}
export { Button, buttonVariants };
