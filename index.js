const express = require("express");
const axios = require("axios");
const bodyParser = require("body-parser");
const app = express();
const port = 3000;

const aikey = ""; //你的openai key
const mjkey = ""; //你的midjourney key
const host = ""; //你的代理地址(国内)

app.use(bodyParser.urlencoded({ limit: "50mb", extended: false }));
app.use(bodyParser.json());

app.post("/imgupload", async (req, res) => {
  req.setTimeout(620000);

  const imagebase64 = req.body.imagebase64;
  const uploadtype = req.body.uploadtype;
  const modeltype = req.body.modeltype;
  const prompt = req.body.prompt;

  if (!imagebase64) {
    return res.status(400).send("Image data is required");
  }

  console.log("Upload type:", uploadtype);

  const result = await generatePic(imagebase64, uploadtype, modeltype, prompt);

  console.log("Result:", result);

  res.send(result);
});

//生成图片
const generatePic = async (imagebase64, uploadtype, modeltype, prompt) => {
  return new Promise((resolve, reject) => {
    //解析图片生成提示词
    const payload = {
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content:
            "You are an expert in generating prompts based on images, all outputs are English prompt phrases without line breaks, in a format like this: big eye, black hair, white clothes, describe as detailed as possible.",
        },
        {
          role: "user",
          content: [
            {
              type: "image_url",
              image_url: { url: `data:image/jpeg;base64,${imagebase64}` },
            },
            {
              type: "text",
              text: "Please describe this image.",
            },
          ],
        },
      ],
    };

    const headers = {
      Accept: "application/json",
      Authorization: `Bearer ${aikey}`,
      "Content-Type": "application/json",
    };

    axios
      .post(`https://${host}/v1/chat/completions`, payload, {
        headers,
      })
      .then(async (response) => {
        // Step 5: 获取模型响应
        const messageContent = response.data.choices[0].message.content;
        console.log("Response from GPT-4:", messageContent);

        let imagePrompt = ``;

        //没有提示词
        if (prompt == "") {
          console.log("无提示词");
          if (uploadtype == "BubbleMattStyle") {
            imagePrompt = `${messageContent} ,3d Pixar character style, ip by pop mart，soft colors, soft lighting, high detail, art station, art, ip, blind box, 8k, best quality, 3d, c4d, blender --iw 2 --ar 1:1`;
          } else if (uploadtype == "CartoonStyle") {
            imagePrompt = `${messageContent} ,disney，creating an elegant yet powerful silhouette. The background is a vivid blend of contrasting colors, with dramatic lighting that adds depth and tension to the scene. This conceptual artwork captures the essence of a cinematic moment, reimagining the classic Disney character in a bold, powerful, and exciting new way. , vibrant, photo, conceptual art, cinematic, painting --iw 2 --ar 1:1`;

            if (modeltype == "midjourney") {
              imagePrompt += " --niji";
            }
          } else if (uploadtype == "CyberpunkStyle") {
            console.log("赛博朋克");
            imagePrompt = `${messageContent},(machine construction:1.3),cyberpunk style photo,cyberpunk setting, high contrast, hyper realistic, reflections, cinematic, retrofuturism, at night, red lights and neon lights --iw 2 --ar 1:1 --stylize 750`;
          }
        } else {
          imagePrompt = `${messageContent}, ${prompt}`;
        }

        if (modeltype == "flux") {
          // Step 6: 构建第二个请求的 Payload

          const payloadForImageGeneration = {
            model: "flux",
            prompt: imagePrompt,
            size: "1024x1024",
            n: 1,
            image: imagebase64,
          };

          // Step 7: 发送生成图像请求
          axios
            .post(
              `https://${host}/v1/images/generations`,
              payloadForImageGeneration,
              { headers }
            )
            .then((imageResponse) => {
              console.log(
                "Image Generation Response:",
                imageResponse.data.data[0].url
              );
              resolve({
                url: [imageResponse.data.data[0].url],
                state: "success",
              });
            })
            .catch((err) => {
              console.error("Error generating image:", err);
              reject(err);
            });
        } else if (modeltype == "midjourney") {
          let result = await generateMjImage(
            imagePrompt,
            modeltype,
            imagebase64
          );
          resolve(result);
        }
      })
      .catch((err) => {
        console.error("Error generating prompt:", err);
        reject(err);
      });
  });
};

//mj生成任务
async function generateMjImage(prompt, modeltype, imagebase64) {
  return new Promise(async (resolve, reject) => {
    const headers = {
      Accept: "application/json",
      Authorization: `Bearer ${mjkey}`,
    };
    try {
      console.log("启动任务1");
      // Step 1: 提交mj绘画生成任务
      const generationResponse = await axios.post(
        `https://${host}/mj/submit/imagine`,
        {
          botType: "MID_JOURNEY",
          prompt,
          base64Array: [`data:image/jpeg;base64,${imagebase64}`],
        },
        { headers }
      );

      console.log("启动任务", generationResponse.data);

      if (
        generationResponse.data.code != 1 &&
        generationResponse.data.code != 22
      ) {
        return { message: generationResponse.data.message, state: "error" };
      }

      const generationId = generationResponse.data.result;
      console.log("Generation ID:", generationId);

      // Step 2: 轮询生成结果

      let result = await MJ_pollRequest(
        `https://${host}/mj/task/${generationId}/fetch`,
        1000000,
        generationId
      );

      console.log("轮询结果:", result);

      resolve(result);
    } catch (error) {
      console.error("Error generating image:", error);
      reject({ url: "Internal server error", state: "error" });
    }
  });
}

//mj轮询
function MJ_pollRequest(url, timeout, taskId) {
  return new Promise((resolve, reject) => {
    const startTime = Date.now();
    const headers = {
      Accept: "application/json",
      Authorization: `Bearer ${mjkey}`,
    };

    const interval = setInterval(async () => {
      try {
        // 发送请求
        const response = await axios.get(url, { headers });
        const data = response.data; // 获取 JSON 数据

        console.log("画图进度:", data.progress);

        // 检查是否满足条件
        if (data.status === "SUCCESS") {
          clearInterval(interval);
          console.log("查询成功:", data.imageUrl);
          console.log("画图数据:", data);
          //提交图片放大任务
          let imgtemp_1 = [];
          for (let i = 0; i < data.buttons.length && i < 4; i++) {
            await new Promise((resolve1) => setTimeout(resolve1, 1000));
            try {
              let t1 = await MJ_upscale(data.buttons[i].customId, taskId);
              imgtemp_1.push(t1.result);
            } catch (error) {
              console.log("放大任务出错:", error);
            }
          }

          //查询放大任务
          console.log("提交任务回执:", imgtemp_1);
          let imgarr = await Promise.all(
            imgtemp_1.map(async (item, index) => {
              if (item != undefined) {
                console.log("准备查询:", item);

                let t1 = await MJ_pollRequest_upscale(item);
                return t1;
              }
            })
          );

          let imgarr_1 = imgarr.filter((item) => item != undefined);

          console.log("imgarr:", imgarr_1);
          //查询放大任务
          resolve({ state: "success", url: imgarr_1 });
        }
      } catch (error) {
        console.error("请求出错:", error.message);
      }

      // 检查是否超时
      if (Date.now() - startTime >= timeout) {
        clearInterval(interval);
        resolve({ state: "fail", url: "" });
      }
    }, 1000); // 每秒请求一次
  });
}

//mj放大图片
function MJ_upscale(customId, taskId) {
  return new Promise(async (resolve, reject) => {
    const headers = {
      Accept: "application/json",
      Authorization: `Bearer ${mjkey}`,
    };

    let result = await axios.post(
      `https://${host}/mj/submit/action`,
      {
        chooseSameChannel: true,
        customId,
        taskId,
      },
      { headers }
    );

    console.log("放大结果:", result.data);

    resolve(result.data);
  });
}

//查询放大任务
function MJ_pollRequest_upscale(resultid) {
  let timeout = 1000000;
  return new Promise(async (resolve, reject) => {
    const startTime = Date.now();
    const headers = {
      Accept: "application/json",
      Authorization: `Bearer ${mjkey}`,
    };

    const interval = setInterval(async () => {
      try {
        // 发送请求
        const response = await axios.get(
          `https://${host}/mj/task/${resultid}/fetch`,
          { headers }
        );
        const data = response.data; // 获取 JSON 数据

        console.log("画图进度:", data.progress);

        // 检查是否满足条件
        if (data.status === "SUCCESS") {
          clearInterval(interval);
          resolve(data.imageUrl);
        }
      } catch (error) {
        console.error("请求出错:", error.message);
      }

      // 检查是否超时
      if (Date.now() - startTime >= timeout) {
        clearInterval(interval);
        resolve("timeout");
      }
    }, 1000); // 每秒请求一次
  });
}

app.listen(port, () => {
  console.log(`Server is running on http://localhost:${port}`);
});
