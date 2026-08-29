import { type CanActivate, Injectable } from '@nestjs/common';

/**
 * Guarda no-op: esta entrega não tem autenticação. Existe para marcar o lugar — validar o token
 * do provedor e resolver o `providerId` a partir da claim seria mudança só aqui dentro.
 *
 * Enquanto isso o `providerId` é auto-declarado, o que não afrouxa nada: a referência continua
 * tendo que bater em provider, player, wallet, moeda e rodada.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  canActivate(): boolean {
    return true;
  }
}
