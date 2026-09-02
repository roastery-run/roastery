import type { FormField } from "@roastery/schemas";
import {
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
} from "@roastery/ui";

/**
 * Renders a template. Used by the builder's preview AND by the scoresheet, so
 * what a QC lead designs is literally what a cupper is shown.
 */
export function CustomFields({
  fields,
  values,
  onChange,
}: {
  fields: FormField[];
  values: Record<string, unknown>;
  onChange: (key: string, value: unknown) => void;
}) {
  if (!fields.length)
    return <p className="text-muted-foreground text-sm">No custom fields on this template.</p>;

  return (
    <div className="space-y-3">
      {fields.map((field) => {
        const id = `custom-${field.key}`;
        return (
          <div key={field.key} className="space-y-1.5">
            <Label htmlFor={id}>
              {field.label || field.key}
              {field.required ? <span aria-hidden="true"> *</span> : null}
              {field.required ? <span className="sr-only"> (required)</span> : null}
            </Label>

            {field.type === "boolean" ? (
              <div className="flex items-center gap-2">
                <Switch
                  id={id}
                  checked={values[field.key] === true}
                  onCheckedChange={(checked) => onChange(field.key, checked)}
                />
                <span className="text-muted-foreground text-sm">
                  {values[field.key] === true ? "Yes" : "No"}
                </span>
              </div>
            ) : field.type === "select" ? (
              <Select
                value={(values[field.key] as string) ?? ""}
                onValueChange={(value) => onChange(field.key, value)}
              >
                <SelectTrigger id={id}>
                  <SelectValue placeholder="Choose" />
                </SelectTrigger>
                <SelectContent>
                  {(field.options ?? []).map((option) => (
                    <SelectItem key={option} value={option}>
                      {option}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <Input
                id={id}
                value={(values[field.key] as string | number | undefined) ?? ""}
                inputMode={field.type === "number" ? "decimal" : undefined}
                min={field.min}
                max={field.max}
                step={field.step}
                className={field.type === "number" ? "text-right font-mono" : undefined}
                onChange={(event) => {
                  if (field.type !== "number") return onChange(field.key, event.target.value);
                  const parsed = Number.parseFloat(event.target.value);
                  onChange(field.key, Number.isNaN(parsed) ? undefined : parsed);
                }}
              />
            )}

            {field.help ? (
              <p className="text-muted-foreground text-xs">{field.help}</p>
            ) : field.type === "number" && (field.min !== undefined || field.max !== undefined) ? (
              <p className="text-muted-foreground text-xs">
                {field.min ?? "—"} to {field.max ?? "—"}
              </p>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
