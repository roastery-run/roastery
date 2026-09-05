import type { FormField } from "@roastery/schemas";
import {
  Field,
  FieldDescription,
  FieldLabel,
  Input,
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
        const help =
          field.help ??
          (field.type === "number" && (field.min !== undefined || field.max !== undefined)
            ? `${field.min ?? "—"} to ${field.max ?? "—"}`
            : null);
        // Wired by id rather than left as loose text underneath: a range a
        // screen-reader user never hears is a range they will get wrong.
        const describedBy = help ? `${id}-description` : undefined;
        return (
          <Field key={field.key}>
            <FieldLabel htmlFor={id}>
              {field.label || field.key}
              {field.required ? <span aria-hidden="true"> *</span> : null}
              {field.required ? <span className="sr-only"> (required)</span> : null}
            </FieldLabel>

            {field.type === "boolean" ? (
              <div className="flex items-center gap-2">
                <Switch
                  id={id}
                  aria-describedby={describedBy}
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
                <SelectTrigger id={id} aria-describedby={describedBy}>
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
                aria-describedby={describedBy}
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

            {help ? (
              <FieldDescription id={describedBy} className="text-xs">
                {help}
              </FieldDescription>
            ) : null}
          </Field>
        );
      })}
    </div>
  );
}
