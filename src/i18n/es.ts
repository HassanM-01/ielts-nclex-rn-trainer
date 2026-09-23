// Spanish UI strings. Every user-facing string for Julio lives here.

export const es = {
  app: {
    title: "Entrenador de Speaking IELTS",
    underConstruction: "La aplicación está en construcción. Muy pronto podrás practicar aquí.",
  },

  browser: {
    unsupported:
      "Esta aplicación necesita Microsoft Edge o Google Chrome para reconocer tu voz. Ábrela en Edge (recomendado: tiene las voces más naturales) o en Chrome.",
  },

  micCheck: {
    title: "Prueba del micrófono",
    noticeTitle: "Antes de empezar",
    notice:
      "Mientras el micrófono está encendido, el navegador envía tu voz a Google (en Chrome) o a Microsoft (en Edge) para convertirla en texto. Nosotros no guardamos tu audio. Para mejores resultados, usa audífonos y busca un lugar tranquilo.",
    noticeOk: "Entendido",
    intro: "Vamos a grabar 3 segundos. Di una frase en inglés, por ejemplo: “My name is Julio and I am a nurse.”",
    record: "Grabar 3 segundos",
    recording: "Grabando… habla ahora",
    playing: "Reproduciendo tu grabación…",
    heard: "Esto es lo que entendimos:",
    heardNothing: "No entendimos nada. Revisa que el micrófono esté conectado y vuelve a intentarlo.",
    noPlayback: "No pudimos reproducir la grabación, pero el reconocimiento de voz funciona.",
    retry: "Repetir la prueba",
    level: "Nivel del micrófono",
    micInUse: "Micrófono en uso:",
    micUnknown: "desconocido",
    wrongMic:
      "¿No es el micrófono correcto? Haz clic en el ícono que está a la izquierda de la dirección de la página, elige tu micrófono en «Micrófono» y vuelve a cargar la página. Si conectas tus audífonos después, la aplicación cambia a su micrófono sola.",
    headphonesQuestion: "¿Usas audífonos?",
    headphonesYes: "Sí, uso audífonos",
    headphonesNo: "No, uso las bocinas de la computadora",
    headphonesAdvice:
      "Te recomendamos mucho usar audífonos: así el examinador no se escucha en tu micrófono y puedes interrumpirlo si hace falta.",
    examinerTest: "Ahora vas a escuchar al examinador.",
    done: "¡Listo! El micrófono y la voz funcionan.",
  },

  recognition: {
    network:
      "El reconocimiento de voz no responde en este navegador. Puedes seguir usando el botón “Mantén presionado para hablar”, o abrir la aplicación en {other}.",
    notAllowed:
      "El navegador bloqueó el micrófono. Haz clic en el candado junto a la dirección de la página, permite el micrófono y vuelve a cargar la página.",
    audioCapture: "No encontramos un micrófono. Conecta uno (o tus audífonos con micrófono) y vuelve a cargar la página.",
    language: "Este navegador no puede reconocer inglés. Abre la aplicación en {other}.",
    start:
      "El reconocimiento de voz no pudo iniciar. Puedes seguir usando el botón “Mantén presionado para hablar”, o abrir la aplicación en {other}.",
    unsupported:
      "Este navegador no tiene reconocimiento de voz. Abre la aplicación en Microsoft Edge o en Google Chrome.",
    pushToTalk: "Mantén presionado para hablar",
    pushToTalkActive: "Escuchando… suelta cuando termines",
    otherBrowserEdge: "Microsoft Edge",
    otherBrowserChrome: "Google Chrome",
  },

  home: {
    start: "Empezar examen",
    startHint: "Examen completo: presentación, Parte 1 y Parte 2 (unos 10 minutos). Usa audífonos si puedes.",
    micCheckAgain: "Probar el micrófono",
    hideMicCheck: "Ocultar la prueba del micrófono",
    resumeTitle: "Tienes un examen sin terminar",
    resumeBody: "Puedes continuar desde la siguiente pregunta o ver lo que respondiste hasta ahora.",
    resume: "Continuar examen",
    viewSoFar: "Ver mis respuestas",
    discard: "Descartar",
    lastExam: "Ver la transcripción de tu último examen",
    micBlocked:
      "El navegador no nos deja usar el micrófono. Haz clic en el ícono a la izquierda de la dirección, permite el micrófono y vuelve a cargar la página.",
  },

  exam: {
    parts: {
      idle: "Examen",
      warmup: "Comenzando",
      opening: "Presentación",
      part1: "Parte 1",
      part2_prep: "Parte 2 · preparación",
      part2_speak: "Parte 2 · tu turno",
      part2_roundoff: "Parte 2",
      part3: "Parte 3",
      closing: "Cierre",
      grading: "Calificando",
      results: "Terminado",
    },
    status: {
      speaking: "hablando",
      listening: "escuchando",
      thinking: "pensando",
      preparing: "preparando",
    },
    prepLeft: "Tiempo para preparar",
    speakLeft: "Tiempo para hablar",
    partTime: "Tiempo en esta parte",
    notes: "Tus notas",
    notesPlaceholder: "Escribe aquí tus ideas (solo tú las ves).",
    liveTranscript: "Lo que estamos escuchando",
    repeat: "Repetir pregunta",
    end: "Terminar",
    endConfirm: "¿Terminar el examen ahora? Guardaremos lo que respondiste.",
    endYes: "Sí, terminar",
    endNo: "No, seguir",
    spaceHint: "Cuando termines de responder, puedes presionar la barra espaciadora (“Listo”). No es obligatorio.",
    noExam: "No hay un examen en curso.",
    backHome: "Volver al inicio",
  },

  transcript: {
    title: "Tu examen",
    unfinished: "Terminaste el examen antes del final.",
    gradingSoon: "La calificación con bandas llegará en una próxima versión. Por ahora puedes revisar lo que dijiste.",
    none: "No hay ningún examen guardado.",
    noAnswer: "(sin respuesta)",
    timeLimit: "El examinador te interrumpió por tiempo.",
    hardStop: "Se acabaron los 2 minutos.",
    repeated: "Pregunta repetida",
    backupPrompt: "El examinador te pidió que siguieras hablando.",
    ended: "Terminaste aquí.",
    notes: "Tus notas de la Parte 2",
    partLabel: { 0: "Presentación", 1: "Parte 1", 2: "Parte 2", 3: "Parte 3" } as Record<number, string>,
    backHome: "Volver al inicio",
  },

  vad: {
    unavailable:
      "No pudimos medir el volumen del micrófono. El examen funciona igual, pero sin el medidor de nivel.",
  },
} as const;

export type Strings = typeof es;
