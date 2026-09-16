/**
 * Gera uma string de pagamento PIX Estático (BR Code)
 * 
 * @param key Chave PIX
 * @param amount Valor do pagamento
 * @param city Cidade do favorecido
 * @param name Nome do favorecido
 * @param description Descrição do pagamento (opcional)
 * @returns String do PIX Copia e Cola
 */
export const generatePixPayload = (
  key: string,
  amount: number,
  city: string = "SAO PAULO",
  name: string = "CLIENTE",
  description: string = ""
): string => {
  // Limpa a chave
  const cleanKey = String(key ?? "").replace(/\s/g, "");
  
  // Formata o valor
  const numericAmount = Number(amount);
  const amountStr = (Number.isFinite(numericAmount) ? Math.max(0, numericAmount) : 0).toFixed(2);
  
  // Helper para formatar campos do EMV
  const f = (id: string, val: string) => {
    const len = val.length.toString().padStart(2, "0");
    return `${id}${len}${val}`;
  };

  const payload = [
    f("00", "01"), // Payload Format Indicator
    f("26", [
      f("00", "br.gov.bcb.pix"),
      f("01", cleanKey),
      description ? f("02", String(description).substring(0, 25)) : ""
    ].join("")),
    f("52", "0000"), // Merchant Category Code
    f("53", "986"), // Transaction Currency (BRL)
    f("54", amountStr), // Transaction Amount
    f("58", "BR"), // Country Code
    f("59", String(name ?? "CLIENTE").substring(0, 25).toUpperCase()), // Merchant Name
    f("60", String(city ?? "SAO PAULO").substring(0, 15).toUpperCase()), // Merchant City
    f("62", f("05", "***")), // Additional Data Field Template (TXID)
  ].join("");

  // Calcula o CRC16 (CCITT)
  const crcPayload = payload + "6304";
  let crc = 0xFFFF;
  for (let i = 0; i < crcPayload.length; i++) {
    crc ^= crcPayload.charCodeAt(i) << 8;
    for (let j = 0; j < 8; j++) {
      if ((crc & 0x8000) !== 0) {
        crc = (crc << 1) ^ 0x1021;
      } else {
        crc = crc << 1;
      }
    }
  }
  const finalCrc = (crc & 0xFFFF).toString(16).toUpperCase().padStart(4, "0");
  
  return crcPayload + finalCrc;
};
