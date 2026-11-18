import { HttpClient, HttpErrorResponse, HttpHeaders } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';

/** Erreur renvoyée par l'API HPO Visio : { error: "message", ... } */
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly body: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  if (err instanceof Error) return err.message;
  return 'Une erreur est survenue.';
}

/**
 * Petit client de l'API (/api/...). Les appels renvoient des promesses :
 * plus simple à lire dans les composants que des Observables.
 */
@Injectable({ providedIn: 'root' })
export class Api {
  private readonly http = inject(HttpClient);

  get<T>(url: string, headers?: Record<string, string>): Promise<T> {
    return this.run(this.http.get<T>(url, { headers: new HttpHeaders(headers ?? {}) }));
  }
  post<T>(url: string, body: unknown = {}, headers?: Record<string, string>): Promise<T> {
    return this.run(this.http.post<T>(url, body, { headers: new HttpHeaders(headers ?? {}) }));
  }
  postText<T>(url: string, text: string, contentType = 'text/csv'): Promise<T> {
    return this.run(this.http.post<T>(url, text, { headers: new HttpHeaders({ 'Content-Type': contentType }) }));
  }
  put<T>(url: string, body: unknown): Promise<T> {
    return this.run(this.http.put<T>(url, body));
  }
  patch<T>(url: string, body: unknown): Promise<T> {
    return this.run(this.http.patch<T>(url, body));
  }
  delete<T>(url: string): Promise<T> {
    return this.run(this.http.delete<T>(url));
  }

  private async run<T>(obs: import('rxjs').Observable<T>): Promise<T> {
    try {
      return await firstValueFrom(obs);
    } catch (e) {
      if (e instanceof HttpErrorResponse) {
        const body = (typeof e.error === 'object' && e.error) || {};
        const msg =
          (body as { error?: string }).error ??
          (e.status === 0 ? 'Serveur injoignable. Vérifiez votre connexion.' : `Erreur ${e.status}`);
        throw new ApiError(e.status, msg, body as Record<string, unknown>);
      }
      throw e;
    }
  }
}
