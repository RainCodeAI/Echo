import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export const metadata = { title: "Leads" };

export default function LeadsPage() {
  return (
    <div className="mx-auto max-w-5xl">
      <Card>
        <CardHeader>
          <CardTitle>Leads</CardTitle>
          <CardDescription>
            Lightweight lead records for linking field notes. Full CRUD in the next pass.
          </CardDescription>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          Local Echo leads table is defined in the schema (not a stub).
        </CardContent>
      </Card>
    </div>
  );
}
