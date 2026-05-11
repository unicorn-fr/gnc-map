// Compression d'image côté client avant upload
// Cible : ≤ 1200px sur le grand côté, qualité JPEG 0.72
// Résultat typique : 150-200 Ko au lieu de 3-8 Mo originaux
// Qualité visuelle excellente sur écran de smartphone

export const compressImage = (file) =>
  new Promise((resolve) => {
    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d')
    const img = new Image()
    img.onload = () => {
      const MAX = 1200
      const ratio = Math.min(MAX / img.width, MAX / img.height, 1)
      canvas.width  = Math.round(img.width  * ratio)
      canvas.height = Math.round(img.height * ratio)
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
      canvas.toBlob(
        (blob) => resolve(new File([blob], file.name, { type: 'image/jpeg' })),
        'image/jpeg',
        0.72
      )
      URL.revokeObjectURL(img.src)
    }
    img.src = URL.createObjectURL(file)
  })
