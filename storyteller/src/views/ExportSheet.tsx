import { useEffect, useState } from 'preact/hooks';
import { ClipboardCopy, FileCode2, FileText, Printer, Share2 } from 'lucide-preact';
import { safeFilename, canShareFiles, printHtml, printIsUnavailable, saveFile, shareFile } from '../export/files';
import { toPrintableHtml, toScript } from '../export/script';
import { serializeStory } from '../format/serializer';
import type { Story } from '../format/types';
import { showToast } from '../store/storyStore';
import { Row, Switch } from '../ui/controls';
import { Sheet, closeSheet } from '../ui/overlay';
import { copyText } from './shared';

function report(outcome: string, what: string) {
  if (outcome === 'saved') showToast(`${what} saved`);
  else if (outcome === 'failed') showToast(`Couldn't save the ${what.toLowerCase()}. Try Copy instead.`);
}

/** Every way to get one story out of the app. */
export function ExportSheet({ story }: { story: Story }) {
  const [notes, setNotes] = useState(false);
  const [noPrint, setNoPrint] = useState(false);
  const name = safeFilename(story.title);

  useEffect(() => {
    void printIsUnavailable().then(setNoPrint);
  }, []);

  const done = () => closeSheet();

  const storyFile = async () => {
    report(await saveFile(`${name}.story`, serializeStory(story)), 'Story file');
    done();
  };
  const script = async () => {
    report(await saveFile(`${name}.md`, toScript(story, { notes }), 'text/markdown'), 'Script');
    done();
  };
  const print = async () => {
    const html = toPrintableHtml(story, { notes });
    if (noPrint) report(await saveFile(`${name} (print).html`, html, 'text/html'), 'Printable page');
    else printHtml(html);
    done();
  };
  const copy = async () => {
    showToast((await copyText(toScript(story, { notes }))) ? 'Script copied' : 'Copy failed');
    done();
  };
  const share = async () => {
    if (!(await shareFile(`${name}.story`, serializeStory(story)))) showToast('Sharing was cancelled');
    done();
  };

  return (
    <Sheet title={`Export “${story.title}”`}>
      <div class="group-card">
        <Row icon={<FileCode2 size={20} />} label="Story file (.story)" hint="Edit with AI or import again later" onClick={storyFile} />
        <Row icon={<FileText size={20} />} label="Script (Markdown)" hint="Readable script for documents and sharing" onClick={script} />
        <Row
          icon={<Printer size={20} />}
          label={noPrint ? 'Printable page (.html)' : 'Print or save as PDF'}
          hint={noPrint ? 'Open it in your browser, then print or save as PDF' : 'Laid out like a play script'}
          onClick={print}
        />
        <Row icon={<ClipboardCopy size={20} />} label="Copy script" hint="Paste it anywhere" onClick={copy} />
        {canShareFiles() && <Row icon={<Share2 size={20} />} label="Share…" hint="Send the story file to another app" onClick={share} />}
      </div>
      <div class="group-card">
        <Row label="Include notes" hint="Your // notes, in the script and print versions" htmlFor="export-notes">
          <Switch id="export-notes" label="Include notes" checked={notes} onChange={setNotes} />
        </Row>
      </div>
    </Sheet>
  );
}
