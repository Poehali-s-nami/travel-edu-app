const ts = require("typescript");

// Also serves as the TypeScript loader for the isolated component preview.
module.exports = function (source) {
  return ts.transpileModule(source, {
    compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 }
  }).outputText;
};

async function main() {
  const assert = require("node:assert/strict");
  const fs = require("node:fs");
  const path = require("node:path");
  const http = require("node:http");
  const root = path.resolve(__dirname, "..");
  const output = path.join(root, "outputs", "track-content-check");
  fs.mkdirSync(output, { recursive: true });
  const helper = { exports: {} };
  const helperSource = ts.transpileModule(fs.readFileSync(path.join(root, "src/lib/track-content.ts"), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS }
  }).outputText;
  new Function("exports", helperSource)(helper.exports);
  const { getTrackEntries } = helper.exports;
  const materials = [{ id: "lesson" }, { id: "file", hiddenFromLibrary: true }];
  const note = (id, afterMaterialId, enabled = true) => ({ id, afterMaterialId, enabled, title: id, text: "" });
  const ids = (entries) => entries.map((entry) => entry.kind === "info" ? entry.block.id : entry.material.id);
  assert.deepEqual(ids(getTrackEntries({ materialIds: ["lesson", "file"] }, materials)), ["lesson", "file"]);
  const track = { materialIds: ["lesson", "file"], infoBlocks: [note("intro", ""), note("meeting", "lesson"), note("off", "file", false)] };
  assert.deepEqual(ids(getTrackEntries(track, materials)), ["intro", "lesson", "meeting", "file"]);
  assert.deepEqual(ids(getTrackEntries({ ...track, materialIds: ["file", "lesson"] }, materials)), ["intro", "file", "lesson", "meeting"]);
  assert.deepEqual(ids(getTrackEntries({ ...track, materialIds: ["file"] }, materials)), ["intro", "file", "meeting"]);
  assert.deepEqual(ids(getTrackEntries(track, [materials[1]])), ["intro", "meeting", "file"]);
  console.log("PASS: legacy tracks, hidden materials, disabled notes, ordering, removed materials");

  const webpackBundle = require("next/dist/compiled/webpack/webpack");
  webpackBundle.init();
  const entry = `
    import React, { useState } from 'react';
    import { createRoot } from 'react-dom/client';
    import { TrackModal } from '@/components/TrackModal';
    import { TrackInfoEditor } from '@/components/TrackInfoEditor';
    import { TrackMaterialPicker } from '@/components/TrackMaterialPicker';
    import { TrackPreview } from '@/components/TrackPreview';
    import { UnsavedEditorProvider, useEditorDraft, useEditorNavigation } from '@/components/UnsavedEditor';
    const materials = [
      {id:'lesson',title:'Практический видеоурок',description:'Подбор тура и работа с клиентом',type:'video',hiddenFromLibrary:true,url:'about:blank',category:[],format:'Видео'},
      {id:'file',title:'Скачать раздаточные материалы',description:'Памятка для самостоятельной практики',type:'file',url:'about:blank',category:[],format:'PDF'},
      {id:'new',title:'Новый урок',description:'Дополнительная практика',type:'video',url:'about:blank',category:[],format:'Видео'}
    ];
    function DraftHarness() {
      const [title,setTitle]=useState('Исходный текст');
      const [failed,setFailed]=useState(false);
      const [saved,setSaved]=useState('');
      const navigate=useEditorNavigation();
      const save=useEditorDraft({title},async()=>{if(failed)return false;setSaved(title);return true;},()=>setTitle(saved || 'Исходный текст'));
      return React.createElement('section',{'data-testid':'draft'},
        React.createElement('input',{'aria-label':'Черновик',value:title,onChange:e=>setTitle(e.target.value)}),
        React.createElement('input',{type:'checkbox','aria-label':'Ошибка сохранения',checked:failed,onChange:e=>setFailed(e.target.checked)}),
        React.createElement('button',{onClick:()=>void save()},'Сохранить черновик'),
        React.createElement('button',{onClick:()=>navigate(()=>document.body.dataset.left='yes')},'Выйти из редактора'),
        React.createElement('output',{'data-testid':'saved'},saved)
      );
    }
    function App() {
      const [blocks,setBlocks]=useState([{id:'meeting',title:'Встреча с куратором',text:'Обсудите вопросы после урока. https://example.com/meeting',enabled:true,afterMaterialId:'lesson'}]);
      const [completed,setCompleted]=useState(new Set());
      const [preview,setPreview]=useState(true);
      const [selectedIds,setSelectedIds]=useState(['lesson','file']);
      const track={id:'test',title:'Практическое обучение туризму',description:'Уроки и материалы для самостоятельной работы',materialIds:selectedIds,infoBlocks:blocks,testUrl:'https://example.com/test'};
      return React.createElement(React.Fragment,null,
        React.createElement('button',{onClick:()=>setPreview(true)},'Открыть предпросмотр'),
        React.createElement('button',{onClick:()=>setSelectedIds([...selectedIds,'new'])},'Добавить новый урок'),
        React.createElement(TrackPreview,{track,materials}),
        React.createElement(TrackMaterialPicker,{materials,selectedIds,onToggle:id=>setSelectedIds(selectedIds.includes(id)?selectedIds.filter(x=>x!==id):[...selectedIds,id]),onMove:(from,to)=>{const next=[...selectedIds];const [item]=next.splice(from,1);next.splice(to,0,item);setSelectedIds(next)}}),
        React.createElement(UnsavedEditorProvider,null,React.createElement(DraftHarness)),
        React.createElement(TrackInfoEditor,{blocks,materialIds:track.materialIds,materials,onChange:setBlocks}),
        preview && React.createElement(TrackModal,{track,materials,completedMaterialIds:completed,onClose:()=>setPreview(false),onOpenMaterial:(m)=>setCompleted(new Set([...completed,m.id])),onOpenTest:()=>document.body.dataset.testOpened='yes'})
      );
    }
    createRoot(document.getElementById('root')).render(React.createElement(App));
  `;
  await new Promise((resolve, reject) => {
    const compiler = webpackBundle.webpack({
      mode: "development", devtool: false, context: root,
      entry: `data:text/javascript;base64,${Buffer.from(entry, "utf8").toString("base64")}`,
      output: { path: output, filename: "preview.js" },
      resolve: { alias: { "@": path.join(root, "src") }, extensions: [".tsx", ".ts", ".js"] },
      module: { rules: [{ test: /\.tsx?$/, use: [__filename] }] }
    });
    compiler.run((error, stats) => compiler.close(() => {
      if (error || stats.hasErrors()) reject(error || new Error(stats.toString({ all: false, errors: true })));
      else resolve();
    }));
  });
  const css = await require("postcss")([require("tailwindcss")({
    content: [path.join(root, "src/components/*.tsx")]
  })]).process("@tailwind base; @tailwind components; @tailwind utilities;", { from: undefined });
  const server = http.createServer((request, response) => {
    if (request.url === "/preview.js") { response.setHeader("Content-Type", "application/javascript"); response.end(fs.readFileSync(path.join(output, "preview.js"))); }
    else { response.setHeader("Content-Type", "text/html; charset=utf-8"); response.end(`<meta name="viewport" content="width=device-width, initial-scale=1"><style>${css.css}</style><div id="root"></div><script src="/preview.js"></script>`); }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  let browser;
  try {
    const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
    browser = await chromium.launch({ headless: true, channel: "msedge" });
    const page = await browser.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    const testButton = page.getByRole("button", { name: "Перейти к тестированию" });
    assert.equal(await testButton.isDisabled(), true);
    await page.getByRole("button", { name: /Практический видеоурок/ }).click();
    assert.equal(await testButton.isDisabled(), true);
    await page.getByRole("button", { name: /Скачать раздаточные материалы/ }).click();
    assert.equal(await testButton.isEnabled(), true);
    await testButton.click();
    assert.equal(await page.locator("body").getAttribute("data-test-opened"), "yes");
    assert.equal(await page.getByRole("link", { name: "https://example.com/meeting", exact: true }).getAttribute("rel"), "noopener noreferrer");
    for (const width of [390, 1280]) {
      await page.setViewportSize({ width, height: 844 });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      const bounds = await testButton.boundingBox();
      assert.ok(bounds.y >= 0 && bounds.y + bounds.height <= 844);
      await page.screenshot({ path: path.join(output, `track-${width}.png`) });
    }
    await page.getByRole("button", { name: "Закрыть", exact: true }).click();
    await page.getByRole("button", { name: "Добавить новый урок", exact: true }).click();
    await page.getByRole("button", { name: "Открыть предпросмотр", exact: true }).click();
    assert.equal(await testButton.isDisabled(), true);
    assert.equal(await page.getByText("Завершено материалов: 2 из 3", {exact:true}).count(), 1);
    await page.getByRole("button", { name: /Новый урок/ }).click();
    assert.equal(await testButton.isEnabled(), true);
    await page.getByRole("button", { name: "Закрыть", exact: true }).click();
    await page.getByLabel("Заголовок").fill("Обсуждение практики");
    await page.getByLabel("Место в треке").selectOption("");
    await page.getByRole("button", { name: "Открыть предпросмотр" }).click();
    assert.equal(await page.locator("aside").last().getByRole("heading").textContent(), "Обсуждение практики");
    await page.getByRole("button", { name: "Закрыть", exact: true }).click();
    await page.getByLabel("Показывать в треке").uncheck();
    await page.getByRole("button", { name: "Открыть предпросмотр" }).click();
    assert.equal(await page.locator("aside").count(), 0);
    await page.getByRole("button", { name: "Закрыть", exact: true }).click();
    await page.getByRole("button", { name: "Добавить инфополе" }).click();
    assert.equal(await page.getByLabel("Заголовок").count(), 2);
    await page.getByLabel("Заголовок").nth(1).fill("Второй блок");
    await page.getByRole("button", { name: "Выше среди инфополей", exact: true }).nth(1).click();
    assert.equal(await page.getByLabel("Заголовок").first().inputValue(), "Второй блок");
    await page.getByRole("button", { name: "Удалить инфополе", exact: true }).first().click();
    assert.equal(await page.getByLabel("Заголовок").count(), 1);
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.screenshot({ path: path.join(output, "editor-mobile.png"), fullPage: true });
    const search = page.getByRole("searchbox", { name: "Поиск материалов по названию" });
    await search.fill("ПРАКТИЧЕСКИЙ");
    assert.equal(await page.getByRole("checkbox", {name:/Практический видеоурок/}).count(), 1);
    assert.equal(await page.getByRole("checkbox", {name:/Скачать раздаточные/}).count(), 0);
    assert.equal(await page.getByText("Видео · Скрыт из библиотеки", {exact:true}).count(), 1);
    await search.fill("Нет такого материала");
    assert.equal(await page.getByText("Материалы не найдены.", {exact:true}).count(), 1);
    await search.fill("");
    await page.getByRole("button", {name:"Переместить материал выше",exact:true}).nth(1).click();
    await page.getByRole("button", {name:"Посмотреть глазами сотрудника",exact:true}).click();
    assert.equal(await page.getByText("Предпросмотр · Обучающий трек",{exact:true}).count(),1);
    assert.equal(await page.getByText("Завершено материалов: 0 из 3",{exact:true}).count(),1);
    await page.getByRole("button",{name:"Закрыть",exact:true}).click();
    const draft = page.getByRole("textbox",{name:"Черновик",exact:true});
    const leave = page.getByRole("button",{name:"Выйти из редактора",exact:true});
    await draft.fill("Новые правки");
    assert.equal(await page.evaluate(() => {
      const event = new Event("beforeunload", { cancelable: true });
      window.dispatchEvent(event);
      return event.defaultPrevented;
    }), true);
    await leave.click();
    assert.equal(await page.getByRole("dialog").count(),1);
    await page.getByRole("button",{name:"Остаться",exact:true}).click();
    assert.equal(await draft.inputValue(),"Новые правки");
    await page.getByRole("checkbox",{name:"Ошибка сохранения",exact:true}).check();
    await leave.click();
    await page.getByRole("button",{name:"Сохранить и продолжить",exact:true}).click();
    assert.equal(await page.getByRole("alert").count(),1);
    assert.equal(await page.locator("body").getAttribute("data-left"),null);
    await page.getByRole("button",{name:"Остаться",exact:true}).click();
    await page.getByRole("checkbox",{name:"Ошибка сохранения",exact:true}).uncheck();
    await leave.click();
    await page.getByRole("button",{name:"Сохранить и продолжить",exact:true}).click();
    assert.equal(await page.getByTestId("saved").textContent(),"Новые правки");
    assert.equal(await page.getByRole("dialog").count(),0);
    await draft.fill("Отменить правки");
    await leave.click();
    await page.getByRole("button",{name:"Не сохранять",exact:true}).click();
    assert.equal(await draft.inputValue(),"Новые правки");
    await leave.click();
    assert.equal(await page.getByRole("dialog").count(),0);
    await draft.fill("Сохранить вручную");
    await page.getByRole("button",{name:"Сохранить черновик",exact:true}).click();
    await leave.click();
    assert.equal(await page.getByRole("dialog").count(),0);
    assert.deepEqual(errors, []);
    console.log("PASS: progress gating, notes CRUD, placement, visibility, safe links, desktop/mobile layout");
    console.log("PASS: new lesson preserves progress, search, ordering, isolated preview, unsaved changes and failed saves");
    console.log(`Screenshots: ${output}`);
  } finally {
    if (browser) await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
}

if (require.main === module) main().catch((error) => { console.error(error); process.exitCode = 1; });
