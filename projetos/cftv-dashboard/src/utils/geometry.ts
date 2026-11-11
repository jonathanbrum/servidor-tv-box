export interface Point {
  x: number;
  y: number;
}

export const PRESET_FENCES: Record<string, Point[]> = {
  portao: [
    { x: 55, y: 290 },
    { x: 180, y: 175 },
    { x: 470, y: 190 },
    { x: 565, y: 320 },
    { x: 230, y: 345 },
  ],
  garagem: [
    { x: 90, y: 90 },
    { x: 510, y: 90 },
    { x: 510, y: 320 },
    { x: 90, y: 320 },
  ],
  calcada: [
    { x: 40, y: 240 },
    { x: 560, y: 240 },
    { x: 560, y: 340 },
    { x: 40, y: 340 },
  ],
  total: [
    { x: 20, y: 20 },
    { x: 580, y: 20 },
    { x: 580, y: 340 },
    { x: 20, y: 340 },
  ],
};

/**
 * Mapeia classes do modelo COCO-SSD para as categorias internas de configuração.
 */
export const COCO_TO_SETTING_CLASS: Record<string, string> = {
  person: 'person',
  car: 'car',
  truck: 'car',
  bus: 'car',
  motorcycle: 'motorcycle',
  bicycle: 'motorcycle',
  dog: 'animal',
  cat: 'animal',
};

export const COCO_CLASS_LABEL_PT: Record<string, string> = {
  person: 'Pessoa',
  car: 'Carro',
  truck: 'Carro',
  bus: 'Carro',
  motorcycle: 'Moto',
  bicycle: 'Moto',
  dog: 'Animal',
  cat: 'Animal',
};

/**
 * Verifica se um ponto (coordenadas normalizadas 600x360) está dentro do polígono da cerca virtual.
 */
export function isPointInPoly(pt: Point, poly: Point[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x;
    const yi = poly[i].y;
    const xj = poly[j].x;
    const yj = poly[j].y;
    const intersect =
      yi > pt.y !== yj > pt.y &&
      pt.x < ((xj - xi) * (pt.y - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}
