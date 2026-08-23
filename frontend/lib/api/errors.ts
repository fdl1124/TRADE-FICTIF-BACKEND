import type { ApiError } from "@/lib/types"

const messages:Record<string,{message:string;action:string}>={
INSUFFICIENT_BALANCE:{message:"Le solde disponible ne couvre pas cet ordre.",action:"Réduisez la quantité ou fermez une position."},
INVALID_SYMBOL:{message:"Cet actif n’est pas disponible au trading.",action:"Choisissez un symbole depuis la liste Marché."},
MARKET_CLOSED:{message:"Le marché actions est actuellement fermé.",action:"Réessayez pendant la séance américaine, de 9 h 30 à 16 h (New York)."},
STALE_PRICE_DATA:{message:"Le dernier prix est trop ancien pour exécuter cet ordre.",action:"Attendez la reconnexion des prix avant de réessayer."},
POSITION_SIZE_EXCEEDED:{message:"Cette position dépasse la limite de risque configurée.",action:"Réduisez la taille proposée ou ajustez la limite de l’agent."},
DAILY_LOSS_LIMIT_REACHED:{message:"La limite de perte journalière a été atteinte.",action:"Le circuit breaker bloque toute nouvelle exécution IA aujourd’hui."},
UNAUTHORIZED:{message:"Votre session n’est plus valide.",action:"Reconnectez-vous pour continuer."},
}
export function humanizeApiError(error:ApiError|string){const code=typeof error==="string"?error:error.error;return messages[code]??{message:typeof error==="string"?"Une erreur inattendue est survenue.":error.message,action:"Réessayez. Si le problème persiste, vérifiez votre connexion."}}
export class TradingApiError extends Error implements ApiError{constructor(public error:string,message:string,public details?:unknown){super(message);this.name="TradingApiError"}}
