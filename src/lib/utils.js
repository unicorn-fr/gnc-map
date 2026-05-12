// Retourne uniquement le prénom (premier mot) d'un nom complet
export const firstName = (fullName) => fullName?.split(' ')[0] ?? fullName ?? ''
