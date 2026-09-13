// The auth_spec contract (DESIGN-NOTES §2.7, connection-data-flow.html
// §authspec): describes the SHAPE of the credential a server needs —
// never a value. Defined once by the registrant at registration (real MCP
// servers don't advertise this themselves), then read-only. Drives what
// the Connections form renders and how a stored credential attaches to an
// outgoing MCP call.
import { z } from "zod";

export const AuthFieldSchema = z
  .object({
    key: z.string().min(1),
    label: z.string().min(1),
    help: z.string().optional(),
    secret: z.boolean(),
  })
  .strict();

export const AuthSpecSchema = z
  .object({
    type: z.enum(["bearer", "header", "basic", "query"]),
    fields: z.array(AuthFieldSchema).min(1),
    // Required for "header" (the header name) and "query" (the param name) —
    // bearer/basic have a fixed attachment shape and don't need one.
    headerName: z.string().optional(),
    queryParam: z.string().optional(),
  })
  .strict()
  .refine((s) => s.type !== "header" || !!s.headerName, {
    message: "headerName is required when type is 'header'",
  })
  .refine((s) => s.type !== "query" || !!s.queryParam, {
    message: "queryParam is required when type is 'query'",
  });

export type AuthField = z.infer<typeof AuthFieldSchema>;
export type AuthSpec = z.infer<typeof AuthSpecSchema>;

/** Splits a values map into the secret fields (→ encrypted) and non-secret fields (→ plain config), per each field's `secret` flag. */
export function splitAuthValues(
  authSpec: AuthSpec,
  values: Record<string, string>
): { secretValues: Record<string, string>; configValues: Record<string, string> } {
  const secretValues: Record<string, string> = {};
  const configValues: Record<string, string> = {};
  for (const field of authSpec.fields) {
    const value = values[field.key];
    if (value === undefined) continue;
    if (field.secret) secretValues[field.key] = value;
    else configValues[field.key] = value;
  }
  return { secretValues, configValues };
}

/** Attaches decrypted credential values to an outgoing request per auth_spec.type — the "use" side of the contract (step 20 in connection-data-flow.html). */
export function attachAuth(
  authSpec: AuthSpec,
  values: Record<string, string>
): { headers: Record<string, string>; queryParams: Record<string, string> } {
  const firstValue = authSpec.fields[0] ? values[authSpec.fields[0].key] : undefined;

  switch (authSpec.type) {
    case "bearer":
      return firstValue ? { headers: { Authorization: `Bearer ${firstValue}` }, queryParams: {} } : { headers: {}, queryParams: {} };
    case "header":
      return firstValue && authSpec.headerName
        ? { headers: { [authSpec.headerName]: firstValue }, queryParams: {} }
        : { headers: {}, queryParams: {} };
    case "basic": {
      const [userField, passField] = authSpec.fields;
      const user = userField ? values[userField.key] : undefined;
      const pass = passField ? values[passField.key] : undefined;
      if (user === undefined || pass === undefined) return { headers: {}, queryParams: {} };
      return { headers: { Authorization: `Basic ${Buffer.from(`${user}:${pass}`).toString("base64")}` }, queryParams: {} };
    }
    case "query":
      return firstValue && authSpec.queryParam
        ? { headers: {}, queryParams: { [authSpec.queryParam]: firstValue } }
        : { headers: {}, queryParams: {} };
  }
}
