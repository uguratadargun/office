import * as React from "react"

import { cn } from "@/modern/lib/cn"

/** `forwardRef` for the reason spelled out in `./button.tsx` (MD-131), reached
 *  here by the quieter route (MD-133): nothing anchors a popper to this box,
 *  but `AgentsOverview` holds a ref to it and focuses it when a dispatch is
 *  seeded from elsewhere in the app. React 18 dropped that ref before this
 *  component ever saw it, so `box.current?.focus()` optional-chained past a
 *  null every time — the text appeared and the cursor never arrived. */
const Textarea = React.forwardRef<HTMLTextAreaElement, React.ComponentProps<"textarea">>(
  function Textarea({ className, ...props }, ref) {
    return (
      <textarea
        ref={ref}
        data-slot="textarea"
        className={cn(
          "flex field-sizing-content min-h-16 w-full rounded-md border border-input bg-transparent px-3 py-2 text-base shadow-xs transition-[color,box-shadow] outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 md:text-sm dark:bg-input/30 dark:aria-invalid:ring-destructive/40",
          className
        )}
        {...props}
      />
    )
  }
)

export { Textarea }
