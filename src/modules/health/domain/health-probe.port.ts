export const HEALTH_PROBES = 'HealthProbes';

/** Uma dependência externa sem a qual o serviço não consegue trabalhar. */
export interface HealthProbe {
  readonly name: string;
  /** Resolve se a dependência respondeu; lança se não. */
  check(): Promise<void>;
}
