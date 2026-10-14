import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors motion-safe:duration-(--dur-quick) disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "bg-accent text-accent-foreground hover:opacity-90",
        outline:
          "border border-border bg-surface text-foreground hover:bg-surface-hover hover:border-border-strong",
        ghost: "text-muted-foreground hover:bg-surface-hover hover:text-foreground",
        subtle: "bg-surface-sunken text-foreground hover:bg-surface-hover",
        link: "text-accent underline-offset-4 hover:underline",
      },
      size: {
        // 36px+ targets on desktop; `touch` is used wherever fingers are expected.
        sm: "h-8 px-2.5 text-[13px] [&_svg]:size-3.5",
        default: "h-9 px-3.5 [&_svg]:size-4",
        lg: "h-10 px-4 [&_svg]:size-4",
        icon: "size-9 [&_svg]:size-4",
        touch: "h-11 px-4 [&_svg]:size-4",
        "icon-touch": "size-11 [&_svg]:size-5",
      },
    },
    defaultVariants: { variant: "outline", size: "default" },
  },
);

export type ButtonProps = React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & { asChild?: boolean };

export function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: ButtonProps) {
  const Comp = asChild ? Slot : "button";
  return (
    <Comp className={cn(buttonVariants({ variant, size }), className)} {...props} />
  );
}

export { buttonVariants };
