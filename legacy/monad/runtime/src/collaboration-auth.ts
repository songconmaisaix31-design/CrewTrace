import { Auth,type Principal } from './auth.js';
import { AppError } from './errors.js';

export async function collaborationPrincipal(auth: Auth,principal: Principal,credential?: string): Promise<Principal> {
  if(credential===undefined) return principal;
  const supplied=await auth.authenticate(`Bearer ${credential}`);
  if(supplied.kind!=='collaborator') throw new AppError(403,'UNAUTHORIZED','credential 参数只接受公开协作 Agent 的私密凭证');
  if(principal.kind!=='public' && (principal.kind!=='collaborator' || principal.credentialId!==supplied.credentialId)) {
    throw new AppError(403,'UNAUTHORIZED','Authorization 与 credential 必须使用同一协作凭证');
  }
  return supplied;
}
