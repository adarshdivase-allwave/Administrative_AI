import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Construction } from "lucide-react";

/**
 * Stand-in for modules whose UI hasn't been built yet. The backend is fully
 * wired for all of these — they just need their vertical slice implemented.
 * Use as `<PlaceholderPage title="..." spec="..." />`.
 */
export function PlaceholderPage({
  title,
  spec,
  nextSteps = [],
}: {
  title: string;
  spec: string;
  nextSteps?: string[];
}) {
  return (
    <div className="space-y-4 max-w-2xl">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
          {title}
          <Badge variant="secondary">
            <Construction className="h-3 w-3 mr-1" />
            UI coming soon
          </Badge>
        </h1>
        <p className="text-sm text-muted-foreground">{spec}</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Backend is ready</CardTitle>
          <CardDescription>
            All the data models, Lambdas, and resolvers for this module exist in the backend.
            Only the UI vertical slice is pending.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <p className="font-medium">What this screen will do:</p>
          <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
            {nextSteps.length > 0 ? (
              nextSteps.map((s, i) => <li key={i}>{s}</li>)
            ) : (
              <>
                <li>Render a list / detail / form for this module</li>
                <li>Call the relevant AppSync queries and mutations</li>
                <li>Honor the role-based permissions already enforced by the backend</li>
              </>
            )}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
