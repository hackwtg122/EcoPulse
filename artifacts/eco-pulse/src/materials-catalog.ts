// EcoPulse — biblioteca pública de materiales.
// Contenido de orientación general basado en la Resolución 2184 de 2019 (separación
// por fuentes en Colombia) y buenas prácticas de manejo responsable. Ninguna ficha
// afirma que un centro local acepta el material: esa confirmación depende del centro.

export const materialCategories = ["paper", "plastic", "glass", "metal", "organic", "special"] as const;

export type MaterialCategory = (typeof materialCategories)[number];

export const materialCategoryLabels: Record<MaterialCategory, string> = {
  paper: "Papel y cartón",
  plastic: "Plástico",
  glass: "Vidrio",
  metal: "Metal",
  organic: "Orgánico",
  special: "Manejo especial",
};

export type MaterialSheet = {
  id: string;
  name: string;
  category: MaterialCategory;
  synonyms: string[];
  summary: string;
  yes: string[];
  no: string[];
  before: string[];
  special?: string;
  source: string;
  reviewedAt: string;
};

export const materialSource = "Orientación general — Resolución 2184 de 2019 y buenas prácticas de manejo responsable. Sin validación de un centro local.";
export const materialReviewedAt = "2026-10-17";

const sheet = (data: Omit<MaterialSheet, "source" | "reviewedAt">): MaterialSheet => ({ ...data, source: materialSource, reviewedAt: materialReviewedAt });

export const materialSheets: MaterialSheet[] = [
  sheet({
    id: "carton",
    name: "Caja de cartón",
    category: "paper",
    synonyms: ["cartón", "caja", "caja de domicilio", "caja de mudanza", "cartón corrugado", "caja de envío"],
    summary: "El cartón limpio y seco es uno de los materiales con mayor demanda de reciclaje.",
    yes: ["Aplana las cajas para ocupar menos espacio.", "Entrega cartón limpio y seco en puntos que lo acepten."],
    no: ["No entregues cartón con comida, grasa o humedad: se considera no aprovechable.", "No mezcles con plásticos, cintas ni espumas en un mismo bulto."],
    before: ["Retira cintas, etiquetas grandes y plásticos adheridos.", "Une las tapas con cartón, no con cuerda plástica."],
  }),
  sheet({
    id: "papel",
    name: "Papel de oficina e impresión",
    category: "paper",
    synonyms: ["papel", "hojas", "hojas impresas", "papel de impresora", "documento", "papel blanco"],
    summary: "Papel de oficina, impresiones y documentos se reciclan junto con la familia del papel.",
    yes: ["Mantenlo seco y sin grasa.", "Grapas y clips pequeños pueden quedarse; se separan en planta."],
    no: ["No incluyas papel higiénico, servilletas usadas ni papel grasiento.", "No entregues papel mojado: pierde la fibra."],
    before: ["Retira plásticos, carpetas y cubiertas.", "Si contiene datos personales, destrúyelos antes de reciclar."],
  }),
  sheet({
    id: "periodico",
    name: "Periódico y revistas",
    category: "paper",
    synonyms: ["periódico", "revista", "papelillo", "suplemento", "gaceta"],
    summary: "El papel de periódico y revistas se recicla con la misma ruta del papel.",
    yes: ["Agrúpalos atados para facilitar su transporte."],
    no: ["No los entregues mojados ni con restos de comida."],
    before: ["Retira las fundas plásticas de las revistas."],
  }),
  sheet({
    id: "libro",
    name: "Libros y cuadernos",
    category: "paper",
    synonyms: ["libro", "cuaderno", "agenda", "cuaderno de notas"],
    summary: "La pasta y el papel interior pueden reciclarse, pero no todos los centros los reciben.",
    yes: ["Consulta con el centro si acepta libros antes de llevarlos."],
    no: ["No asumas que todos los puntos reciben libros: muchos los rechazan por la encuadernación."],
    before: ["Retira grapas, espirales y marcapáginas.", "Si el centro lo permite, separa la pasta dura del papel interior."],
  }),
  sheet({
    id: "pet",
    name: "Botella plástica (PET)",
    category: "plastic",
    synonyms: ["botella de gaseosa", "botella de agua", "botella plástica", "pet", "botella de refresco", "botella de jugo"],
    summary: "El PET es el plástico con mejor infraestructura de reciclaje en Colombia.",
    yes: ["Aplasta el envase para reducir volumen.", "Entrega botellas limpias y destapadas."],
    no: ["No entregues botellas con líquido o comida.", "No entregues envases de otros plásticos mezclados como si fueran PET."],
    before: ["Vacía, enjuaga y destapa.", "Retira el etiquetado si se separa fácilmente."],
  }),
  sheet({
    id: "bolsa-plastica",
    name: "Bolsa plástica",
    category: "plastic",
    synonyms: ["bolsa", "bolsa de mercado", "bolsa plástica", "bolsa de camiseta", "bolsa de plástico"],
    summary: "Las bolsas casi nunca se reciclan en el contenedor común; requieren canales posconsumo.",
    yes: ["Junta varias bolsas limpias y entrégalas juntas si el punto las acepta."],
    no: ["No las dejes volando: contaminan ríos y zonas verdes.", "No las arrojes al contenedor común esperando que se reciclen."],
    before: ["Limpia y seca; retira restos de comida y tickets."],
  }),
  sheet({
    id: "envase-flexible",
    name: "Envase de yogur u otro envase flexible",
    category: "plastic",
    synonyms: ["vasito", "envase de yogur", "bolsa de leche", "envase flexible", "envase de atún", "tapa plástica"],
    summary: "Muchos envases flexibles son multilamina y solo se reciclan por posconsumo, si un punto local los acepta.",
    yes: ["Si el punto local tiene programa de posconsumo para envases flexibles, úsalo."],
    no: ["No asumas que todos los plásticos se reciclan: la forma flexible casi nunca entra a la ruta convencional."],
    before: ["Vacía, enjuaga y seca.", "Separa la tapa si es de otro material."],
  }),
  sheet({
    id: "icopor",
    name: "Envase de icopor (EPS)",
    category: "plastic",
    synonyms: ["icopor", "politeno", "vasito de icopor", "bandeja de icopor", "expanded polystyrene", "icopor blanco"],
    summary: "El icopor no se degrada y casi nunca se recicla en rutas locales; se gestiona por campañas o posconsumo.",
    yes: ["Reduce su volumen si lo guardas para llevarlo a una campaña de recolección."],
    no: ["No lo quemes: libera sustancias tóxicas.", "No lo dejes en espacios públicos ni en el contenedor común."],
    before: ["Retira etiquetas y restos de comida.", "Consulta si existe campaña o punto de posconsumo en tu municipio."],
    special: "El icopor se acumula en el ambiente por décadas. Si no hay canal posconsumo local, la opción honesta es reducir su uso, no fingir que se recicla.",
  }),
  sheet({
    id: "botella-vidrio",
    name: "Botella de vidrio",
    category: "glass",
    synonyms: ["botella", "botella de vidrio", "botella de gaseosa de vidrio", "botella de cerveza", "botella de vino"],
    summary: "El vidrio es reciclable de forma ilimitada si se separa por tipo.",
    yes: ["Separa por color si el centro lo pide: transparente, ámbar y verde."],
    no: ["No mezcles con cerámica, loza ni espejos: no son vidrio reciclable.", "No entregues piezas rotas sin proteger."],
    before: ["Vacía y enjuaga.", "Retira tapas, corchos y etiquetas grandes."],
  }),
  sheet({
    id: "frasco-vidrio",
    name: "Frasco de vidrio",
    category: "glass",
    synonyms: ["frasco", "frasco de mermelada", "frasco de café", "tarro", "frasco de conservas"],
    summary: "Los frascos de vidrio se reciclan como vidrio una vez lavados y sin tapa.",
    yes: ["Con la tapa metálica retirada se recicla junto con el vidrio."],
    no: ["No lleves espejos, cerámica ni loza: no son vidrio reciclable."],
    before: ["Lava y seca el frasco.", "Separa la tapa (metal) del vidrio."],
  }),
  sheet({
    id: "lata-aluminio",
    name: "Lata de aluminio",
    category: "metal",
    synonyms: ["lata", "lata de gaseosa", "lata de cerveza", "lata de refresco", "lata de aluminio"],
    summary: "El aluminio conserva su valor con cada reciclaje; las latas limpias son bien recibidas.",
    yes: ["Aplasta las latas para reducir volumen."],
    no: ["No las entregues con líquido restante ni con comida."],
    before: ["Vacía, enjuaga y seca."],
  }),
  sheet({
    id: "lata-acero",
    name: "Envase metálico de acero",
    category: "metal",
    synonyms: ["lata de atún", "lata de comida", "envase de conserva", "lata de acero", "lata de leche"],
    summary: "Las latas de conserva se reciclan si están limpias y bien cerradas por dentro.",
    yes: ["Guarda las tapas afiladas dentro de la lata para manipularlas con seguridad."],
    no: ["No las entregues con restos de alimentos."],
    before: ["Abre la lata por completo (tapa corrida o biselada).", "Lava y seca."],
  }),
  sheet({
    id: "aluminio-cocina",
    name: "Papel aluminio usado",
    category: "metal",
    synonyms: ["papel aluminio", "foil", "papel de aluminio", "aluminio de cocina"],
    summary: "Limpio se recicla con metales; sucio con grasas casi nunca se acepta.",
    yes: ["Si está limpio, bátelo y entrégalo junto con los metales si el punto lo acepta."],
    no: ["Con grasas y restos de comida casi nunca se acepta."],
    before: ["Limpia si es posible; si está muy sucio, va al residuo no aprovechable."],
  }),
  sheet({
    id: "restos-alimentos",
    name: "Restos de alimentos",
    category: "organic",
    synonyms: ["cáscaras", "comida", "restos de comida", "fruta", "verdura", "organico", "restos orgánicos"],
    summary: "Los restos aprovechables pueden compostarse cuando existe una ruta local de aprovechamiento orgánico.",
    yes: ["Si tu municipio tiene compostaje o recolección separada de orgánicos, úsala."],
    no: ["No los mezcles con plásticos ni empaques.", "No asumas que todos los centros reciben orgánicos: confirma antes."],
    before: ["Retira empaques, palitos y restos no orgánicos.", "Usa un recipiente sin plástico para almacenarlos."],
  }),
  sheet({
    id: "poda",
    name: "Hojas y residuos de poda",
    category: "organic",
    synonyms: ["hojas", "ramas", "poda", "césped", "jardín", "restos de jardín"],
    summary: "Con programas locales de compostaje o jardinería pueden aprovecharse; sin programa, son residuo orgánico volumétrico.",
    yes: ["Aprovecha los días de recolección de poda si tu municipio los tiene."],
    no: ["No quemes residuos de poda al aire libre."],
    before: ["Separa tierra y piedras.", "Reduce el tamaño de las ramas."],
  }),
  sheet({
    id: "pilas",
    name: "Pilas y baterías",
    category: "special",
    synonyms: ["pila", "pilas", "batería", "batería celular", "batería recargable", "acumulador", "batería portátil"],
    summary: "Pilas y baterías son residuos peligrosos: nunca van al contenedor común.",
    yes: ["Guárdalas en un lugar seco y fuera del alcance de niños hasta llevarlas a un canal posconsumo."],
    no: ["No las incineres, entierres ni arrojes a la basera común.", "No las arrojes al inodoro: contaminan el agua."],
    before: ["Protege los bornes con cinta aislante.", "Si están hinchadas o dañadas, manipúlalas con cuidado y no las perfores."],
    special: "Contienen metales pesados que contaminan suelos y aguas. Busca campañas de recolección de pilas de tu municipio o fabricantes con programas de posconsumo.",
  }),
  sheet({
    id: "medicamentos",
    name: "Medicamentos vencidos",
    category: "special",
    synonyms: ["medicamento", "medicamentos", "pastillas", "jarabe", "ampolla", "medicina vencida"],
    summary: "Los medicamentos son residuos peligrosos: nunca al inodoro ni a la basera común.",
    yes: ["Devuélvelos a farmacias u hospitales que operen devolución de medicamentos; verifica antes si ofrecen ese servicio."],
    no: ["No los arrojes, regales ni arrojes al inodoro o desagüe."],
    before: ["Mantenlos en su empaque original con etiqueta legible."],
    special: "Al llegar a ríos o suelos afectan ecosistemas y salud pública. La única vía responsable es la devolución a un canal autorizado.",
  }),
  sheet({
    id: "lamparas",
    name: "Lámparas y fluorescentes",
    category: "special",
    synonyms: ["lámpara", "bombilla", "fluorescente", "tubo fluorescente", "foco", "luminaria"],
    summary: "Los fluorescentes contienen mercurio: romperlos libera vapores peligrosos.",
    yes: ["Guárdalos en su caja original hasta llevarlos a un canal posconsumo."],
    no: ["No los envuelvas en papel periódico: se rompen con facilidad.", "No los arrojes al contenedor común."],
    before: ["Manipula por la base o el tubo con cuidado.", "Si se rompe, ventila el área y recoge los fragmentos sin barrer en seco."],
    special: "El mercurio de un tubo fluorescente contamina agua y suelo. Consulta campañas de recolección de lámparas de tu municipio o del fabricante.",
  }),
  sheet({
    id: "electronico",
    name: "Residuo electrónico (RAEE)",
    category: "special",
    synonyms: ["celular", "cargador", "computador", "televisor", "electrónicos", "raee", "cable", "tablet"],
    summary: "Los equipos electrónicos contienen metales pesados y componentes peligrosos; requieren canal posconsumo.",
    yes: ["Consulta fabricantes o tiendas que reciban posconsumo de equipos en tu zona."],
    no: ["No lo entregues como chatarra común si contiene batería, pantalla o circuitos."],
    before: ["Borra tus datos personales del equipo.", "Retira baterías solo si puedes hacerlo con seguridad."],
    special: "Antes de entregar cualquier equipo, asegúrate de que tus datos estén borrados: EcoPulse no gestiona la eliminación de información de tus dispositivos.",
  }),
  sheet({
    id: "cortopunzantes",
    name: "Agujas y elementos cortopunzantes",
    category: "special",
    synonyms: ["aguja", "jeringa", "lanceta", "bisturí", "cortopunzantes", "agujas"],
    summary: "Residuos con riesgo de infección: nunca al contenedor común ni a recicladores informales.",
    yes: ["Usa un contenedor rígido (envase original o frasco plástico resistente) y consulta servicios de salud para su disposición."],
    no: ["No las reencajes ni las arrojes sueltas.", "No las entregues a recicladores informales: es un riesgo para su salud."],
    before: ["No toques la punta.", "Si te cortaste, busca atención médica antes de manejar los residuos."],
    special: "Este tipo de residuo debe llegar a un canal de salud autorizado. No existe disposición doméstica segura.",
  }),
  sheet({
    id: "aceite-cocina",
    name: "Aceite de cocina usado",
    category: "special",
    synonyms: ["aceite", "aceite usado", "aceite frito", "grasas", "aceite vegetal"],
    summary: "Un litro de aceite puede contaminar miles de litros de agua; nunca al desagüe.",
    yes: ["Guárdalo en un envase cerrado y llévalo a puntos de recolección de aceite si existen en tu zona."],
    no: ["No lo viertas al inodoro, desagüe ni al terreno.", "No lo mezcles con la basera común."],
    before: ["Enfría y filtra restos sólidos antes de almacenarlo."],
    special: "El aceite obstruye redes cloacales y contamina cursos de agua. Verifica si tu municipio o una asociación de recicladores opera un punto de recolección.",
  }),
  sheet({
    id: "pintura",
    name: "Pintura y químicos del hogar",
    category: "special",
    synonyms: ["pintura", "thinner", "químico", "solvente", "insecticida", "madera", "desinfectante"],
    summary: "Pinturas, solventes e insecticidas son residuos peligrosos que requieren manejo especial.",
    yes: ["Consúltalos con la autoridad ambiental local o tiendas especializadas para su disposición."],
    no: ["No los viertas al desagüe ni los mezcles con la basera común."],
    before: ["Mantenlos en su envase original y etiquetado."],
    special: "Estos residuos no tienen disposición doméstica segura: requieren un gestor autorizado. Consulta a la autoridad ambiental de tu municipio.",
  }),
];

export function findMaterialById(id: string): MaterialSheet | undefined {
  return materialSheets.find((material) => material.id === id);
}

export function normalizeSearch(value: string): string {
  return value.trim().normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

export function searchMaterials(query: string, category: MaterialCategory | "all" = "all"): MaterialSheet[] {
  const normalized = normalizeSearch(query);
  const tokens = normalized.split(/\s+/).filter(Boolean);
  return materialSheets.filter((material) => {
    if (category !== "all" && material.category !== category) return false;
    if (!tokens.length) return true;
    const haystack = normalizeSearch([material.name, material.summary, materialCategoryLabels[material.category], ...material.synonyms].join(" "));
    return tokens.every((token) => haystack.includes(token));
  });
}
