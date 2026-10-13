export const TRANSCRIBE_V1_RULES = `Transcribe the supplied PDF page images in reading order into faithful GitHub-flavored Markdown.
Preserve headings, paragraphs, lists, emphasis, links, footnotes, and code. Use LaTeX for mathematics and GFM tables for tabular material. Merge words hyphenated only by a line or page break. Drop repeated running headers, footers, and page numbers.
Represent each meaningful figure as ![caption](figure:page-NNN:x,y,w,h), where NNN is the zero-padded source page and x,y,w,h are normalized decimal coordinates in [0,1]. Do not invent or crop figures. Return only the transcription: no TITLE sentinel, commentary, or code fence around the document.`;

/** @param {{pages?: Array<{n:number, data_url:string}>, tail?: string}} [input] */
export function buildTranscribeInput({ pages = [], tail = "" } = {}) {
  return {
    instructions: TRANSCRIBE_V1_RULES,
    text: [tail ? `The already committed document ends with:\n<tail>\n${tail.slice(-500)}\n</tail>\nContinue without repeating it.` : "Begin the document.",
      ...pages.map((page) => `Source page ${page.n}`)].join("\n"),
    images: pages.map((page) => page.data_url),
  };
}
