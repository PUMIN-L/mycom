import { updateDocument, getDocument } from "./app/lib/documentStore.js";

async function test() {
  try {
    const doc = await getDocument("doc-1749721735508"); // Need a real ID
    console.log("DOC:", doc);
  } catch (e) {
    console.error(e);
  }
}
test();
