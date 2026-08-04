import { z } from "zod";

import {
  PlatformClient,
  type PlatformClientConstructor,
  withCustomObjectSubscriptions,
} from "../dist/index.js";

const withDiagnostics = <TBase extends PlatformClientConstructor>(Base: TBase) =>
  class DiagnosticsPlatformClient extends Base {
    diagnosticLabel(): string {
      return "ready";
    }
  };

const RealtimePlatformClient = PlatformClient.extend(
  withCustomObjectSubscriptions,
);
const ExtendedPlatformClient = RealtimePlatformClient.extend(withDiagnostics);

const constructed = new ExtendedPlatformClient({
  credentials: "include",
  pathPrefix: "/api/archastro/platform",
});
constructed.custom_objects;
constructed.customObjectSubscriptions;
constructed.diagnosticLabel();

const tokenClient = ExtendedPlatformClient.withToken("pk_test", "at_test");
tokenClient.customObjectSubscriptions;
tokenClient.diagnosticLabel();

const secretClient = ExtendedPlatformClient.withSecretKey("sk_test");
secretClient.customObjectSubscriptions;
secretClient.diagnosticLabel();

const credentialsClient = ExtendedPlatformClient.withCredentials(
  "pk_test",
  "developer@example.com",
  "correct horse battery staple",
);
credentialsClient.then((client) => {
  client.customObjectSubscriptions;
  client.diagnosticLabel();
});

const appClient = ExtendedPlatformClient.forApp({
  publishableKey: "pk_test",
  storage: {
    load: async () => null,
    save: async () => {},
    clear: async () => {},
  },
});
appClient.restore;
appClient.customObjectSubscriptions;
appClient.diagnosticLabel();

const DiagramFields = z.object({
  title: z.string(),
  elements_by_id: z.record(z.record(z.unknown())),
});

type DiagramFields = z.infer<typeof DiagramFields>;

constructed.customObjectSubscriptions.subscribe<DiagramFields>({
  objectId: "cobj_diagram",
  fieldsSchema: DiagramFields,
  onSnapshot: (snapshot) => snapshot.fields.title,
  onUpdate: (update) => update.fields.title,
  onStateChange: (state) => state,
  onError: (error) => error,
});
