import * as React from "react";

import { cn } from "@/lib/utils";

const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<"input">>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(
          "flex h-11 w-full rounded-xl border border-primary/25 bg-primary/10 px-3.5 py-2 text-base text-foreground inset-shadow-sm ring-offset-background transition-all file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground/70 hover:border-primary/40 focus-visible:border-primary/60 focus-visible:bg-primary/15 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary/25 focus-visible:ring-offset-0 disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
          className,
        )}
        ref={ref}
        {...props}
      />
    );
  },
);
Input.displayName = "Input";

export { Input };
