// ticket.js
/**
 * Normaliza cualquier formato de datos de venta/recibo (Firestore, Cache local, Borradores, Historial)
 * garantizando que propiedades como Items/items, Total/total, Cliente/cliente, Lista/lista, etc.
 * estén perfectamente estructuradas y disponibles en cualquier variante.
 *
 * @param {Object} v - Objeto de venta original o borrador
 * @returns {Object} Objeto normalizado con campos consistentes
 */
export function normalizarDatosTicket(v) {
    if (!v || typeof v !== "object") {
        return {
            Lista: "#NV-0001",
            lista: "#NV-0001",
            CodigoNota: "#NV-0001",
            codigoNota: "#NV-0001",
            Cliente: "CLIENTE",
            cliente: "CLIENTE",
            FechaTexto: new Date().toLocaleString(),
            fechaTexto: new Date().toLocaleString(),
            Items: [],
            items: [],
            Total: 0,
            total: 0
        };
    }

    // 1. Normalizar Lista / Código de Nota
    const lista = String(v.Lista || v.lista || v.CodigoNota || v.codigoNota || v.idDoc || v.id || "#NV-0001").trim();

    // 2. Normalizar Cliente
    const cliente = String(v.Cliente || v.cliente || v.nombreCliente || "CLIENTE").trim() || "CLIENTE";

    // 3. Normalizar Fecha
    let fechaTexto = v.FechaTexto || v.fechaTexto || v.fecha || v.Fecha || "";
    if (!fechaTexto && (v.timestamp || v.FechaTimestamp || v.ts)) {
        const rawTs = v.timestamp || v.FechaTimestamp || v.ts;
        const tsMs = (typeof rawTs === "number" && rawTs < 10000000000) ? rawTs * 1000 : Number(rawTs);
        if (!isNaN(tsMs) && tsMs > 0) {
            fechaTexto = new Date(tsMs).toLocaleString();
        }
    }
    if (!fechaTexto) {
        fechaTexto = new Date().toLocaleString();
    }

    // 4. Normalizar Ítems / Productos
    const rawItems = Array.isArray(v.Items) 
        ? v.Items 
        : (Array.isArray(v.items) 
            ? v.items 
            : (Array.isArray(v.productos) 
                ? v.productos 
                : (Array.isArray(v.articulos) ? v.articulos : [])));

    const items = rawItems.map((it) => {
        if (!it || typeof it !== "object") return null;

        const prod = String(it.producto || it.Producto || it.nombre || it.name || it.descripcion || "Producto").trim() || "Producto";
        
        const rawCant = it.cantidad ?? it.Cantidad ?? it.cant ?? it.qty ?? it.count ?? 1;
        const cant = Number(rawCant);
        const cantFinal = (isNaN(cant) || cant <= 0) ? 1 : cant;

        const rawPrecio = it.precio ?? it.Precio ?? it.precioUnitario ?? it.price ?? 0;
        const precio = Number(rawPrecio);
        const precioFinal = isNaN(precio) ? 0 : precio;

        let subtotalFinal = 0;
        if (it.subtotal !== undefined && it.subtotal !== null && !isNaN(Number(it.subtotal))) {
            subtotalFinal = Number(it.subtotal);
        } else if (it.Subtotal !== undefined && it.Subtotal !== null && !isNaN(Number(it.Subtotal))) {
            subtotalFinal = Number(it.Subtotal);
        } else {
            subtotalFinal = cantFinal * precioFinal;
        }

        const detalleRaw = it.detalle || it.Detalle || it.observaciones || it.nota || it.obs || "";
        const detalleTrim = String(detalleRaw).trim();
        const detalleFinal = (detalleTrim && detalleTrim !== "-" && detalleTrim !== "undefined" && detalleTrim !== "null") ? detalleTrim : "";

        return {
            producto: prod,
            Producto: prod,
            nombre: prod,
            cantidad: cantFinal,
            Cantidad: cantFinal,
            precio: precioFinal,
            Precio: precioFinal,
            subtotal: subtotalFinal,
            Subtotal: subtotalFinal,
            detalle: detalleFinal,
            Detalle: detalleFinal
        };
    }).filter(Boolean);

    // 5. Normalizar Total
    let total = 0;
    if (v.Total !== undefined && v.Total !== null && !isNaN(Number(v.Total))) {
        total = Number(v.Total);
    } else if (v.total !== undefined && v.total !== null && !isNaN(Number(v.total))) {
        total = Number(v.total);
    } else if (v.montoTotal !== undefined && v.montoTotal !== null && !isNaN(Number(v.montoTotal))) {
        total = Number(v.montoTotal);
    } else {
        total = items.reduce((acc, item) => acc + (item.subtotal || 0), 0);
    }

    return {
        ...v,
        Lista: lista,
        lista: lista,
        CodigoNota: lista,
        codigoNota: lista,
        Cliente: cliente,
        cliente: cliente,
        FechaTexto: fechaTexto,
        fechaTexto: fechaTexto,
        Items: items,
        items: items,
        Total: total,
        total: total
    };
}

/**
 * Renderiza y genera la estructura del ticket/recibo térmico optimizada para 50+ ítems.
 * Utiliza DocumentFragment y construcción atómica de nodos del DOM para garantizar
 * que todos los datos (cliente, productos, cantidades, subtotales y total) se muestren correctamente.
 *
 * @param {Object} rawV - Objeto con datos de la venta.
 * @param {HTMLElement|string|null} [destino=null] - Contenedor DOM opcional donde inyectar el ticket atómicamente.
 * @returns {string} - Representación HTML para compatibilidad.
 */
export function generarEstructuraTicketHTML(rawV, destino = null) {
    if (!rawV) return "";
    const v = normalizarDatosTicket(rawV);
    const items = v.Items;

    // Contenedor principal de la nota (flujo continuo sin cortes forzados y aprovechamiento total del ancho de 80mm)
    const contenedor = document.createElement("div");
    contenedor.className = "ticket-contenedor-impresion";
    contenedor.style.cssText = "width: 100%; max-width: 380px; margin: 0; padding: 0; box-sizing: border-box; font-family: 'Courier New', Courier, monospace; color: #000000; background: #ffffff; display: block; page-break-inside: auto; break-inside: auto;";

    // 1. Bloque de Cabecera
    const headerBloque = document.createElement("div");
    headerBloque.className = "ticket-header-bloque";
    headerBloque.style.cssText = "width: 100%; margin: 0; padding: 0; box-sizing: border-box; page-break-inside: avoid; break-inside: avoid; display: block;";

    const divTitulo = document.createElement("div");
    divTitulo.className = "ticket-titulo";
    divTitulo.style.cssText = "text-align: center; font-weight: 900; font-size: 16px; margin: 0 0 2px 0; padding: 0; line-height: 1.2; display: block; width: 100%; letter-spacing: 0.5px;";
    divTitulo.textContent = "RECIBO";
    headerBloque.appendChild(divTitulo);

    const hr1 = document.createElement("div");
    hr1.className = "ticket-hr";
    hr1.style.cssText = "border-bottom: 1px dashed #000; margin: 4px 0 5px 0; padding: 0; display: block; width: 100%; height: 0; line-height: 0;";
    headerBloque.appendChild(hr1);

    const divLista = document.createElement("div");
    divLista.className = "ticket-linea";
    divLista.style.cssText = "font-size: 14px; font-weight: 900; line-height: 1.3; margin: 0; padding: 0; display: block; width: 100%;";
    divLista.textContent = `Lista: ${v.Lista}`;
    headerBloque.appendChild(divLista);

    const divCliente = document.createElement("div");
    divCliente.className = "ticket-linea";
    divCliente.style.cssText = "font-size: 14px; font-weight: 900; line-height: 1.3; margin: 0; padding: 0; display: block; width: 100%; word-break: break-word;";
    divCliente.textContent = `Cliente: ${v.Cliente}`;
    headerBloque.appendChild(divCliente);

    const divFecha = document.createElement("div");
    divFecha.className = "ticket-linea";
    divFecha.style.cssText = "font-size: 14px; font-weight: 900; line-height: 1.3; margin: 0; padding: 0; display: block; width: 100%;";
    divFecha.textContent = `Fecha: ${v.FechaTexto}`;
    headerBloque.appendChild(divFecha);

    const divItemsCount = document.createElement("div");
    divItemsCount.className = "ticket-linea";
    divItemsCount.style.cssText = "font-size: 13.5px; font-weight: 800; line-height: 1.3; margin: 0; padding: 0; display: block; width: 100%;";
    divItemsCount.textContent = `Ítems: ${items.length} ${items.length === 1 ? 'producto' : 'productos'}`;
    headerBloque.appendChild(divItemsCount);

    const hr2 = document.createElement("div");
    hr2.className = "ticket-hr";
    hr2.style.cssText = "border-bottom: 1px dashed #000; margin: 5px 0 6px 0; padding: 0; display: block; width: 100%; height: 0; line-height: 0;";
    headerBloque.appendChild(hr2);

    contenedor.appendChild(headerBloque);

    // 2. Bloque de Ítems (Construido en memoria con DocumentFragment)
    const itemsListaContenedor = document.createElement("div");
    itemsListaContenedor.className = "ticket-items-lista";
    itemsListaContenedor.style.cssText = "width: 100%; margin: 0; padding: 0; box-sizing: border-box; page-break-inside: auto; break-inside: auto; display: block;";

    const fragmentoItems = document.createDocumentFragment();

    if (items.length === 0) {
        const itemVacio = document.createElement("div");
        itemVacio.style.cssText = "font-size: 13px; font-style: italic; color: #64748b; text-align: center; padding: 8px 0;";
        itemVacio.textContent = "(Sin productos registrados)";
        fragmentoItems.appendChild(itemVacio);
    } else {
        for (let idx = 0; idx < items.length; idx++) {
            const item = items[idx];
            const itemBloque = document.createElement("div");
            itemBloque.className = "ticket-item-bloque";
            itemBloque.style.cssText = "margin: 0 0 5px 0; padding: 0; width: 100%; box-sizing: border-box; page-break-inside: avoid; break-inside: avoid; display: block;";

            // Nombre del producto (ocupa el ancho completo para evitar saltos prematuros de línea)
            const nombreDiv = document.createElement("div");
            nombreDiv.className = "producto-nombre";
            nombreDiv.style.cssText = "font-size: 15px; font-weight: 900; line-height: 1.25; margin: 0 0 2px 0; padding: 0; display: block; width: 100%; word-break: break-word;";
            nombreDiv.textContent = item.producto;
            itemBloque.appendChild(nombreDiv);

            // Detalle adicional si existe
            if (item.detalle) {
                const detalleDiv = document.createElement("div");
                detalleDiv.className = "producto-detalle";
                detalleDiv.style.cssText = "font-size: 12.5px; font-weight: 700; font-style: italic; color: #334155; margin: 0 0 2px 0; padding: 0; line-height: 1.2; display: block; word-break: break-word;";
                detalleDiv.textContent = `(${item.detalle})`;
                itemBloque.appendChild(detalleDiv);
            }

            // Fila de cantidad x precio y subtotal aprovechando el ancho de 80mm
            const filaPrecios = document.createElement("div");
            filaPrecios.className = "ticket-item-precios-row";
            filaPrecios.style.cssText = "display: flex; justify-content: space-between; align-items: baseline; width: 100%; margin: 0; padding: 0; box-sizing: border-box;";

            const cantPrecioSpan = document.createElement("span");
            cantPrecioSpan.className = "producto-cant-precio";
            cantPrecioSpan.style.cssText = "text-align: left; font-size: 14.5px; font-weight: 700; white-space: nowrap; line-height: 1.2; display: inline-block;";
            cantPrecioSpan.textContent = `${item.cantidad} x ${Number(item.precio || 0).toFixed(2)}`;
            filaPrecios.appendChild(cantPrecioSpan);

            const subtotalSpan = document.createElement("span");
            subtotalSpan.className = "producto-subtotal";
            subtotalSpan.style.cssText = "text-align: right; font-size: 14.5px; font-weight: 800; white-space: nowrap; line-height: 1.2; display: inline-block;";
            subtotalSpan.textContent = `Bs. ${Number(item.subtotal || 0).toFixed(2)}`;
            filaPrecios.appendChild(subtotalSpan);

            itemBloque.appendChild(filaPrecios);
            fragmentoItems.appendChild(itemBloque);
        }
    }

    itemsListaContenedor.appendChild(fragmentoItems);
    contenedor.appendChild(itemsListaContenedor);

    // 3. Bloque de Totales
    const totalBloque = document.createElement("div");
    totalBloque.className = "ticket-total-bloque";
    totalBloque.style.cssText = "width: 100%; margin: 0; padding: 0; box-sizing: border-box; page-break-inside: avoid; break-inside: avoid; display: block;";

    const hrTotal = document.createElement("div");
    hrTotal.className = "ticket-hr";
    hrTotal.style.cssText = "border-bottom: 1px dashed #000; margin: 5px 0 5px 0; padding: 0; display: block; width: 100%; height: 0; line-height: 0;";
    totalBloque.appendChild(hrTotal);

    const totalRow = document.createElement("div");
    totalRow.className = "ticket-total-row";
    totalRow.style.cssText = "display: flex; justify-content: space-between; align-items: baseline; width: 100%; margin: 0; padding: 2px 0; box-sizing: border-box; page-break-inside: avoid; break-inside: avoid;";

    const labelTotal = document.createElement("span");
    labelTotal.style.cssText = "text-align: left; margin: 0; font-size: 17px; font-weight: 900; line-height: 1.2; letter-spacing: -0.2px; display: inline-block;";
    labelTotal.textContent = "TOTAL:";
    totalRow.appendChild(labelTotal);

    const valorTotal = document.createElement("span");
    valorTotal.style.cssText = "text-align: right; margin: 0; font-size: 17px; font-weight: 900; line-height: 1.2; white-space: nowrap; display: inline-block;";
    valorTotal.textContent = `Bs. ${Number(v.Total || 0).toFixed(2)}`;
    totalRow.appendChild(valorTotal);

    totalBloque.appendChild(totalRow);
    contenedor.appendChild(totalBloque);

    // 4. Cierre exacto sin papel en blanco sobrante (Cero zonas muertas)
    const espacioCorte = document.createElement("div");
    espacioCorte.className = "ticket-espacio-corte";
    espacioCorte.style.cssText = "width: 100%; height: 0; min-height: 0; margin: 0; padding: 0; display: block; clear: both; page-break-after: avoid; break-after: avoid;";
    contenedor.appendChild(espacioCorte);

    // Si se indicó un contenedor destino, montar atómicamente en el DOM sin recortes ni pantallas en blanco
    if (destino) {
        let elementoDestino = destino;
        if (typeof destino === "string") {
            elementoDestino = document.getElementById(destino);
        }
        if (elementoDestino) {
            if (typeof elementoDestino.replaceChildren === "function") {
                elementoDestino.replaceChildren(contenedor);
            } else {
                elementoDestino.innerHTML = "";
                elementoDestino.appendChild(contenedor);
            }
        }
    }

    return contenedor.outerHTML;
}

export function renderizarTicketDOM(v, destino) {
    return generarEstructuraTicketHTML(v, destino);
}

/**
 * Genera un canvas 2D directo del ticket de alta definición (2x scale) y 100% opaco,
 * garantizando que todos los datos (cliente, lista, productos, cantidades, precios, subtotales y total)
 * se rendericen de forma nítida y visible para compartir por WhatsApp o guardar imagen.
 *
 * @param {Object} rawV - Datos de la venta
 * @returns {HTMLCanvasElement|null}
 */
export function renderizarTicketEnCanvasDirecto(rawV) {
    if (!rawV) return null;
    const v = normalizarDatosTicket(rawV);
    const items = v.Items;

    // Ancho nativo milimétrico para cabezal térmico de 80mm (576px a 203 DPI)
    const baseWidth = 576;
    const paddingX = 8;
    const baseMaxWidthText = baseWidth - (paddingX * 2);

    const dummyCanvas = document.createElement("canvas");
    const dummyCtx = dummyCanvas.getContext("2d");

    function partirTextoEnLineas(ctx, texto, maxW) {
        if (!texto) return [];
        const palabras = String(texto).trim().split(/\s+/);
        const lineas = [];
        let lineaActual = "";

        for (let i = 0; i < palabras.length; i++) {
            const palabra = palabras[i];
            const prueba = lineaActual ? (lineaActual + " " + palabra) : palabra;
            const ancho = ctx.measureText(prueba).width;
            if (ancho <= maxW) {
                lineaActual = prueba;
            } else {
                if (lineaActual) {
                    lineas.push(lineaActual);
                    lineaActual = palabra;
                } else {
                    let pedazo = "";
                    for (let c = 0; c < palabra.length; c++) {
                        if (ctx.measureText(pedazo + palabra[c]).width <= maxW) {
                            pedazo += palabra[c];
                        } else {
                            lineas.push(pedazo);
                            pedazo = palabra[c];
                        }
                    }
                    lineaActual = pedazo;
                }
            }
        }
        if (lineaActual) lineas.push(lineaActual);
        return lineas;
    }

    // 1. Medir altura requerida milimétricamente (pegado arriba con 4px)
    let baseHeight = 4;
    dummyCtx.font = 'bold 26px "Courier New", Courier, monospace';
    baseHeight += 32; // Título RECIBO

    dummyCtx.font = 'bold 22px "Courier New", Courier, monospace';
    baseHeight += 28; // Lista

    const lineasCliente = partirTextoEnLineas(dummyCtx, `Cliente: ${v.Cliente}`, baseMaxWidthText);
    baseHeight += Math.max(1, lineasCliente.length) * 28; // Cliente

    baseHeight += 28; // Fecha
    baseHeight += 26; // Contador de ítems
    baseHeight += 16; // Separador

    const itemsProcesados = [];
    if (items.length === 0) {
        baseHeight += 30; // Mensaje sin ítems
    } else {
        items.forEach(item => {
            dummyCtx.font = 'bold 23px "Courier New", Courier, monospace';
            const nombreProd = item.producto;
            const lineasNombre = partirTextoEnLineas(dummyCtx, nombreProd, baseMaxWidthText);

            let lineasDetalle = [];
            if (item.detalle) {
                dummyCtx.font = 'italic 19px "Courier New", Courier, monospace';
                lineasDetalle = partirTextoEnLineas(dummyCtx, `(${item.detalle})`, baseMaxWidthText);
            }

            let itemH = lineasNombre.length * 28;
            if (lineasDetalle.length > 0) {
                itemH += lineasDetalle.length * 24;
            }
            itemH += 30; // Cantidad x Precio + Subtotal
            itemH += 8;  // Margen entre ítems

            itemsProcesados.push({
                item,
                lineasNombre,
                lineasDetalle,
                itemH
            });

            baseHeight += itemH;
        });
    }

    baseHeight += 16; // Separador
    baseHeight += 44; // TOTAL
    baseHeight += 6;  // Margen final pegado abajo sin espacio en blanco desperdiciado

    const width = baseWidth;
    const canvasHeight = Math.ceil(baseHeight);

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = canvasHeight;
    const ctx = canvas.getContext("2d");

    // Fondo blanco 100% opaco y sólido
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, width, canvasHeight);

    // Texto sólido de alto contraste
    ctx.fillStyle = "#000000";
    let y = 28; // Pegado arriba

    ctx.font = 'bold 26px "Courier New", Courier, monospace';
    ctx.textAlign = "center";
    ctx.fillText("RECIBO", width / 2, y);
    y += 16;

    function dibujarLinea(posy) {
        ctx.save();
        ctx.strokeStyle = "#000000";
        ctx.lineWidth = 2;
        ctx.setLineDash([6, 4]);
        ctx.beginPath();
        ctx.moveTo(paddingX, posy);
        ctx.lineTo(width - paddingX, posy);
        ctx.stroke();
        ctx.restore();
    }

    dibujarLinea(y);
    y += 28;

    ctx.textAlign = "left";
    ctx.font = 'bold 22px "Courier New", Courier, monospace';
    ctx.fillText(`Lista:   ${v.Lista}`, paddingX, y);
    y += 28;

    lineasCliente.forEach(lin => {
        ctx.fillText(lin, paddingX, y);
        y += 28;
    });

    ctx.fillText(`Fecha:   ${v.FechaTexto}`, paddingX, y);
    y += 28;

    ctx.font = 'bold 20px "Courier New", Courier, monospace';
    ctx.fillText(`Ítems:   ${items.length} ${items.length === 1 ? 'producto' : 'productos'}`, paddingX, y);
    y += 16;

    dibujarLinea(y);
    y += 28;

    // Dibujar todos los ítems
    if (items.length === 0) {
        ctx.textAlign = "center";
        ctx.font = 'italic 20px "Courier New", Courier, monospace';
        ctx.fillStyle = "#64748b";
        ctx.fillText("(Sin productos registrados)", width / 2, y);
        y += 28;
        ctx.fillStyle = "#000000";
    } else {
        itemsProcesados.forEach(({ item, lineasNombre, lineasDetalle }) => {
            ctx.textAlign = "left";
            ctx.fillStyle = "#000000";
            ctx.font = 'bold 23px "Courier New", Courier, monospace';
            lineasNombre.forEach(lin => {
                ctx.fillText(lin, paddingX, y);
                y += 28;
            });

            if (lineasDetalle.length > 0) {
                ctx.font = 'italic 19px "Courier New", Courier, monospace';
                ctx.fillStyle = "#475569";
                lineasDetalle.forEach(lin => {
                    ctx.fillText(lin, paddingX, y);
                    y += 24;
                });
                ctx.fillStyle = "#000000";
            }

            ctx.font = 'bold 22px "Courier New", Courier, monospace';
            ctx.textAlign = "left";
            const cant = Number(item.cantidad || 0);
            const precio = Number(item.precio || 0);
            const subtotal = Number(item.subtotal || 0);
            ctx.fillText(`${cant} x ${precio.toFixed(2)}`, paddingX, y);

            ctx.textAlign = "right";
            ctx.fillText(`Bs. ${subtotal.toFixed(2)}`, width - paddingX, y);
            y += 36;
        });
    }

    dibujarLinea(y - 6);
    y += 32;

    ctx.textAlign = "left";
    ctx.font = 'bold 26px "Courier New", Courier, monospace';
    ctx.fillText("TOTAL:", paddingX, y);

    ctx.textAlign = "right";
    ctx.font = 'bold 26px "Courier New", Courier, monospace';
    const totalVal = Number(v.Total || 0);
    ctx.fillText(`Bs. ${totalVal.toFixed(2)}`, width - paddingX, y);

    return canvas;
}

// Vinculación global para entornos de scripts tradicionales
if (typeof window !== "undefined") {
    window.normalizarDatosTicket = normalizarDatosTicket;
    window.generarEstructuraTicketHTML = generarEstructuraTicketHTML;
    window.renderizarTicketDOM = renderizarTicketDOM;
    window.renderizarTicketEnCanvasDirecto = renderizarTicketEnCanvasDirecto;
}
