"use strict";

const { dialogflow } = require("actions-on-google");
const express = require("express");
const bodyParser = require("body-parser");

const app = dialogflow();

const GigyaApi = require("node-gigya-api");
const MyRenaultApi = require("node-my-renault-api");

const expressApp = express();
expressApp.use(bodyParser.json());
expressApp.use(bodyParser.urlencoded({ extended: true }));

let tokenTime = undefined;

const getMyRenault = async conv => {
  const { loginToken, accountId } = conv.user.storage;

  if (!loginToken) {
    conv.ask("Vad är din loginToken?");
    conv.contexts.set("awaiting-token", 5);
    throw Error("loginToken missing...");
  }

  const gigyaApi = new GigyaApi(loginToken);
  const myRenault = new MyRenaultApi(gigyaApi);
  await myRenault.refreshTokens(accountId);

  return myRenault;
};

const getCar = async conv => {
  const { vin } = conv.user.storage;

  const myRenault = await getMyRenault(conv);
  return myRenault.selectCar(vin);
};

const provideToken = async conv => {
  const loginToken = conv.parameters.any;

  const gigyaApi = new GigyaApi(loginToken);
  const myRenault = new MyRenaultApi(gigyaApi, "SE");
  await myRenault.refreshGigyaJWTToken();

  const person = await myRenault.fetchPerson();
  const [{ accountId }] = person.accounts;

  const myAccount = myRenault.selectAccount(accountId);

  const vehicles = await myAccount.fetchVehicles();
  const [{ vin }] = vehicles.vehicleLinks;

  conv.user.storage.loginToken = loginToken;
  conv.user.storage.vin = vin;
  conv.user.storage.accountId = accountId;

  conv.add("Tack nu har jag sparat detta! Din vin är " + vin + ".");

  conv.contexts.delete("awaiting-token");
};

const startHVAC = async conv => {
  const isHeating = conv.query.indexOf("värm") !== -1;
  const isCooling = conv.query.indexOf("kyl") !== -1;

  const getDefaultTemp = () => {
    if (isHeating) {
      return 26;
    }

    if (isCooling) {
      return 18;
    }

    return 21;
  };

  const { amount = getDefaultTemp() } = conv.parameters.temperature;

  if (isHeating) {
    conv.add(
      `Ok, jag sätter igång värmaren tills det är ${amount} grader i bilen!`
    );
  } else if (isCooling) {
    conv.add(`Fixar det, jag börjar kyla ner till ${amount} grader!`);
  } else {
    conv.add(`Inga problem, jag sätter temperaturen på ${amount} grader!`);
  }

  const myCar = await getCar(conv);
  await myCar.startPreconditioning(amount);
};

const getChargeStatus = async conv => {
  const myCar = await getCar(conv);
  const batteryStatus = await myCar.fetchBatteryStatus();

  if (batteryStatus.chargeStatus === 1) {
    conv.add(
      `Batteriet laddas just nu till en effekt av ${(
        batteryStatus.instantaneousPower / 1000 +
        ""
      ).replace(".", ",")} kilowatt.`
    );
  } else {
    conv.add(`Batteriet laddas inte just nu.`);
  }
};

const getTemperature = async conv => {
  const myCar = await getCar(conv);
  const hvacStatus = await myCar.fetchHVACStatus();

  conv.add(`Det är ${hvacStatus.externalTemperature} grader ute just nu.`);
};

const getMileage = async conv => {
  const myCar = await getCar(conv);
  const cockpit = await myCar.fetchCockpit();

  conv.add(
    `Jag har totalt rullat ${Math.round(cockpit.totalMileage / 10)} mil.`
  );
};

const getBatteryStatus = async conv => {
  try {
    const myCar = await getCar(conv);
    const batteryStatus = await myCar.fetchBatteryStatus();

    if (batteryStatus.batteryLevel === 100) {
      conv.add(`Mitt batteri är fulladdat så det är bara ut och köra.`);
    } else {
      conv.add(`Jag har cirka ${batteryStatus.batteryLevel}% batteri kvar.`);
    }
  } catch (err) {}
};

const getBatteryRange = async conv => {
  const myCar = await getCar(conv);
  const batteryStatus = await myCar.fetchBatteryStatus();

  conv.add(`Du borde komma ungefär ${batteryStatus.rangeHvacOff} kilometer.`);
};

const getChargeTimeLeft = async conv => {
  const myCar = await getCar(conv);
  const batteryStatus = await myCar.fetchBatteryStatus();

  if (!batteryStatus.timeRequiredToFullSlow) {
    conv.add(`Jag vet inte...`);
  } else {
    const hours = parseInt(batteryStatus.timeRequiredToFullSlow / 60, 10);
    const minutes = parseInt(
      batteryStatus.timeRequiredToFullSlow - hours * 60,
      10
    );

    let response = `Det är ungefär `;

    if (hours) {
      response += hours + (hours > 1 ? " timmar" : " timme");
    }

    if (minutes) {
      if (hours) {
        response += " och ";
      }

      response += minutes + (minutes > 1 ? " minuter" : " minut");
    }

    response += " kvar.";

    conv.add(response);
  }
};

app.intent("provide-token", provideToken);
app.intent("battery-status", getBatteryStatus);
app.intent("battery-range", getBatteryRange);
app.intent("charge-time-left", getChargeTimeLeft);
app.intent("temperature", getTemperature);
app.intent("charge-status", getChargeStatus);
app.intent("mileage", getMileage);
app.intent("start-hvac", startHVAC);

expressApp.post("/", app);

expressApp.get("/", (req, res) => {
  res.send("ok");
});

console.log("Listening on port 3000");
expressApp.listen(3000);
