import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Config } from '../../core/config.js';
import type { SecretStore } from '../../core/ports.js';

export function secretReference(deployEnv: string, organizationId: string, providerId: string): string {
  return `gatehouse/${deployEnv}/${organizationId}/providers/${providerId}`;
}

/**
 * Credentials in a 0600 JSON file. The default backend: it needs nothing but a disk, which is what
 * makes a single-node deployment work out of the box. The file is plaintext, so it is only as
 * private as the volume holding it — switch to `SECRETS_BACKEND=aws` when that is not enough.
 */
export class FileSecretStore implements SecretStore {
  constructor(private readonly path: string) {}

  private read(): Record<string, Record<string, string>> {
    try {
      return JSON.parse(readFileSync(this.path, 'utf8')) as Record<string, Record<string, string>>;
    } catch {
      return {};
    }
  }

  private write(data: Record<string, Record<string, string>>): void {
    mkdirSync(dirname(this.path), { recursive: true });
    writeFileSync(this.path, JSON.stringify(data), { mode: 0o600 });
    chmodSync(this.path, 0o600);
  }

  async put(reference: string, values: Record<string, string>): Promise<string> {
    this.write({ ...this.read(), [reference]: values });
    return reference;
  }

  async get(reference: string): Promise<Record<string, string>> {
    const value = this.read()[reference];
    if (!value) throw new Error(`Secret not found: ${reference}`);
    return value;
  }

  async delete(reference: string): Promise<void> {
    const data = this.read();
    delete data[reference];
    this.write(data);
  }
}

/**
 * Production. Reached through the task role — there are no static AWS credentials anywhere.
 * In development the same code runs against LocalStack by setting an endpoint override, so the
 * AWS path is exercised for real rather than mocked away.
 */
export class AwsSecretStore implements SecretStore {
  // Imported lazily so a deployment using the file store never loads the AWS SDK.
  private readonly sdk: Promise<{
    aws: typeof import('@aws-sdk/client-secrets-manager');
    client: import('@aws-sdk/client-secrets-manager').SecretsManagerClient;
  }>;

  constructor(options: { endpoint?: string | undefined; region: string }) {
    this.sdk = import('@aws-sdk/client-secrets-manager').then((aws) => ({
      aws,
      client: new aws.SecretsManagerClient({
        region: options.region,
        ...(options.endpoint ? { endpoint: options.endpoint } : {}),
      }),
    }));
  }

  async put(reference: string, values: Record<string, string>): Promise<string> {
    const { aws, client } = await this.sdk;
    const SecretString = JSON.stringify(values);
    try {
      const created = await client.send(new aws.CreateSecretCommand({ Name: reference, SecretString }));
      return created.ARN ?? reference;
    } catch (error) {
      if (!(error instanceof aws.ResourceExistsException)) throw error;
      const updated = await client.send(new aws.PutSecretValueCommand({ SecretId: reference, SecretString }));
      return updated.ARN ?? reference;
    }
  }

  async get(reference: string): Promise<Record<string, string>> {
    const { aws, client } = await this.sdk;
    const result = await client.send(new aws.GetSecretValueCommand({ SecretId: reference }));
    if (!result.SecretString) throw new Error(`Secret has no value: ${reference}`);
    return JSON.parse(result.SecretString) as Record<string, string>;
  }

  async delete(reference: string): Promise<void> {
    const { aws, client } = await this.sdk;
    await client.send(
      new aws.DeleteSecretCommand({ SecretId: reference, ForceDeleteWithoutRecovery: true }),
    );
  }
}

export function createSecretStore(config: Config): SecretStore {
  return config.secretsBackend === 'aws'
    ? new AwsSecretStore({ endpoint: config.awsEndpointUrl, region: config.awsRegion })
    : new FileSecretStore(config.secretsFile);
}
