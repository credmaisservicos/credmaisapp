import * as React from "react";

import { cn } from "@/lib/utils";

export type TextareaProps = React.TextareaHTMLAttributes<HTMLTextAreaElement>;

const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(({ className, ...props }, ref) => {
  return (
    <textarea
      className={cn(
        "flex min-h-[104px] w-full rounded-xl border border-primary/25 bg-primary/10 px-3.5 py-3 text-sm text-foreground inset-shadow-sm ring-offset-background transition-all placeholder:text-muted-foreground/70 hover:border-primary/40 focus-visible:border-primary/60 focus-visible:bg-primary/15 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary/25 focus-visible:ring-offset-0 disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      ref={ref}
      {...props}
    />
  );
});
Textarea.displayName = "Textarea";

export { Textarea };
