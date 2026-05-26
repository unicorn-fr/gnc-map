// Commerciaux GNC — données statiques, jamais en base pour l'affichage.
// Les mêmes UUIDs sont dans init_complet.sql pour les foreign keys.
export const COMMERCIALS = [
  { id: 'c1000000-0000-0000-0000-000000000001', name: 'Cédric',   color: '#2563EB' },
  { id: 'c1000000-0000-0000-0000-000000000002', name: 'Enzo',     color: '#16A34A' },
  { id: 'c1000000-0000-0000-0000-000000000003', name: 'Laëtitia', color: '#D97706' },
]

// Aliases utilisés dans les fichiers Excel (initiales prénom+nom → id)
export const COMMERCIAL_ALIASES = {
  'CT': 'c1000000-0000-0000-0000-000000000001', // Cédric Tissot
  'EM': 'c1000000-0000-0000-0000-000000000002', // Enzo Mercier
  'LJ': 'c1000000-0000-0000-0000-000000000003', // Laëtitia J.
}
