import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export const metadata = { title: "Jobs" };

export default function JobsPage() {
  return (
    <div className="mx-auto max-w-5xl">
      <Card>
        <CardHeader>
          <CardTitle>Jobs</CardTitle>
          <CardDescription>
            Lightweight jobs for linking notes and applying suggested updates.
          </CardDescription>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          Jobs table is in the schema; board UI ships after capture flow.
        </CardContent>
      </Card>
    </div>
  );
}
