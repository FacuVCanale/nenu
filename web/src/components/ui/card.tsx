import * as React from "react";

import { cn } from "@/lib/utils";

// An elevated surface: the card fill and a 1px border, in both themes. No shadow — on the light page
// it doubled the edge and on the dark one it vanished; shadows belong to floating layers.
function Card({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card"
      className={cn(
        "bg-card text-card-foreground flex flex-col gap-6 rounded-xl border py-6",
        className,
      )}
      {...props}
    />
  );
}

export { Card };
