function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename)
    .getContent();
}


/**
 * Create the HTML template and populate the place holders
 */
function doGet() {
  Logger.log("user=" + Session.getActiveUser().getEmail());
  var html = HtmlService.createTemplateFromFile("Venue Booker.html");
  let rooms = getRooms();
  html.spaces = rooms;
  var startTimes = getStartTimes();
  html.startTimes = startTimes;
  html.endTimes = startTimes;
  html.selectedStartTime = generateSelectedStartTime(startTimes, "9:00 am");
  let users = getUsers();
  html.users = users;
  Logger.log("doGet done");
  return html.evaluate().setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/**
 * Callback from HTML
 * Create a calendar entry for each of the selected rooms
 */
function createCalendarEntries(form) {
  Logger.log("user=" + Session.getActiveUser().getEmail());
  Logger.log(form);

  var lastEvent;
  var calendar;
  let returnObject = {};
  let event;
  try {
    let rooms = [form.Spaces].flat().map((JSON_value) => JSON.parse(JSON_value)); 
    returnObject.status = "Success";
    var clashes = [];
    // check for clashes
    rooms.forEach((room) => {     
      clashes.push(...checkRoomAvailability(room, form.BookingDate, form.StartTime, form.EndTime));
    });

    // if there are clashes, process for return to browser
    if (clashes.length) {
      processClashes(returnObject, clashes);
    } else {
    // otherwise, create an event for each romm/calender
      rooms.forEach((room) => {
        calendar = CalendarApp.getCalendarById(room.id);
        eventSeries = createCustomEvent(calendar, form);
        lastEvent = eventSeries;
       // Logger.log(`lastEvent: ${lastEvent}`);
      });

      if (form.Email === "sendEmail" && returnObject.status === "Success") {
       // Logger.log(`eventId: ${lastEvent.getId()}`);
        sendEmail(form, calendar, rooms, lastEvent);
      }

    }
  } catch (error) {
    Logger.log("Error:");   
    Logger.log(error.stack);
    throw new Error(error);
  }

  return returnObject;

}

function createCustomEvent(calendar, form) {
  try {

    const start = createDateFromTime(form.BookingDate, form.StartTime);
    const end = createDateFromTime(form.BookingDate, form.EndTime);

    // Determine User Details
    let user;
    if (form.User === undefined) {
      user = {
        name: 'No user',
        phone: '',
        email: ''
      };
    } else if (form.User.startsWith('Casual user')) {
      user = {
        name: 'Casual user (no details)',
        phone: '',
        email: ''
      };
    } else {
      user = JSON.parse(form.User);
    }

    // Construct Title
    let title = '';
    if (form.BookingType === 'User booking' && !user.name.startsWith('Casual user')) {
      title = user.name + ' ';
    }
    title += form.Title;

    // Construct Description
    let description;
    if (form.BookingType === 'User booking') {
      // description = `${user.name} ${user.email}\n${user.phone}\n\n${form.Notes}`;
      description = `${user.name}\n\n${form.Notes}`;
    } else {
      description = `${form.BookingType}\n\n${form.Notes}`;
      title += ` - ${form.BookingType}`;
    }

    // Create Event Options
    const options = {
      description: description
    };

    let event;
    // ------------- Handle Non-Recurring Events ------------------
    if (form.Frequency === 'none') {
      Logger.log(`CreateEvent: ${calendar.getName()}-${title},${start},${end},${options.description}`);
      event = calendar.createEvent(title, start, end, options);
      // ------------- Handle Recurring  Events ------------------
    } else {
      const recurrenceRule = createRecurring(calendar, form, start, end);
      Logger.log(`CreateEventSeries: ${calendar.getName()}-${title},${start},${end},${recurrenceRule}`);
      event = calendar.createEventSeries(title, start, end, recurrenceRule);
      event.setDescription(description);

    }

    // add guest so get email when changed
    if (user.email != '') {
      event.addGuest(user.email);
    }

    return event;
  } catch (error) {
    Logger.log(`Error creating event: ${error.toString()}`);
    throw new Error(error);
  }
}

/**
 *  Format the list of clashes for display in the browser
 */
function processClashes(returnObject, clashes) {
  returnObject.status = "Clash";
  returnObject.clashes = [];
  returnObject.message = "We couldn't put in your booking because it conflicts with ";

  clashes.forEach((event) => {
    let clash = CalendarApp.getCalendarById(event.getOriginalCalendarId()).getName() + " " + event.getStartTime().toLocaleDateString("en-GB", { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: 'numeric', minute: 'numeric' });
    if (event.getTitle()) {
      clash += " (" + event.getTitle() + ")";
    }
    returnObject.clashes.push(clash);    
  });
  return;
}


/**
 *  Create a recurring event
 */
function createRecurring(calendar, form, startDate, endDate) {

  var recurrence = CalendarApp.newRecurrence();

  // add exceptions
  if (form.Exceptions != undefined) {
    let exceptions = [form.Exceptions].flat();
    for (exception of exceptions) {
      recurrence.addDateExclusion(createDateFromddmmyyyy(exception));
      // Logger.log('Exception date = ' +  new Date(d[2] + '/' + d[1] + '/' + d[0]));
    }
  }

  if (form.Frequency === 'day') {
    recurrence = recurrence.addDailyRule();
  }
  else if (form.Frequency === 'week') {
    let weekdays = [].concat(form.WeekDay || []);
    recurrence = recurrence.addWeeklyRule().onlyOnWeekdays(weekdays.map(function (day) {
      return CalendarApp.Weekday[day];
    }));

  }
  else if (form.Frequency === 'month') {

    if (form.monthlyPattern === 'dayOfMonth') {
      recurrence = recurrence.addMonthlyRule();

      // No additional rule needed - it will use the same day of month
    } else if (form.monthlyPattern === 'dayOfWeek') {
      recurrence = recurrence.addWeeklyRule();
      createMonthlyRecurringEvent(recurrence, calendar, startDate, endDate);
    }

  }
  else if (form.Frequency === 'year') {
    recurrence = recurrence.addYearlyRule();
  }

  recurrence = recurrence.interval(parseInt(form.Interval, 10));

  // Add end condition
  if (form.EndType === 'after') {
    recurrence = recurrence.times(parseInt(form.Occurrences, 10));
  } else if (form.EndType === 'on') {
    let untilDate = new Date(form.EndDate);
    untilDate.setDate(untilDate.getDate() + 1);
    recurrence = recurrence.until(untilDate);
  }
  return recurrence;
}


// ---------------------------------------------------------------------------------------
function retrieveAllEventsInSeries(form, calendar, eventSeries) {
  const seriesId = eventSeries.getId();
  const startTime = createDateFromTime(form.BookingDate, form.StartTime);
  let endTime = new Date();
  endTime.setFullYear(endTime.getFullYear() + 10);

  // Get all events in the series within the time range
  //await new Promise(r => setTimeout(r, 2000)); // is this needed? - allows time for events to be created?
  let events = calendar.getEvents(startTime, endTime, { search: eventSeries.getTitle() });
  events = events.filter(event => event.getId() === seriesId);

  // Filter events to ensure they belong to the series (optional, based on title or other criteria)
  // events.forEach((event, index) => {
  //   Logger.log(`Event ${index + 1}: ${event.getTitle()} - Start: ${event.getStartTime()} - End: ${event.getEndTime()} - ID ${event.getId()}`);
  // });
  //Logger.log(`Total events in series: ${events.length}`);

  return events;
}




//  function createMonthlyRecurringEvent(recurrence, calendar, startDate, endDate) { 

//   // Calculate the relative day of the month (e.g., 3rd Tuesday)
//   var dayOfWeek = startDate.getDay(); // 0 (Sunday) to 6 (Saturday)
//   var weekOfMonth = Math.ceil(startDate.getDate() / 7); // Week of the month (1st, 2nd, 3rd, etc.)

//   // Create the recurrence rule
//     recurrence = recurrence    
//     .setWeekOfMonth(weekOfMonth) // Preserve week position
//     .onlyOnWeekday(mapDayToWeekday(dayOfWeek)); // Preserve weekday 

// }

// // Helper function to convert day of week (0-6) to CalendarApp.Day enum
// function getCalendarAppDayOfWeek(dayOfWeek) {
//   var days = [
//     CalendarApp.Weekday.SUNDAY,
//     CalendarApp.Weekday.MONDAY,
//     CalendarApp.Weekday.TUESDAY,
//     CalendarApp.Weekday.WEDNESDAY,
//     CalendarApp.Weekday.THURSDAY,
//     CalendarApp.Weekday.FRIDAY,
//     CalendarApp.Weekday.SATURDAY
//   ];
//   return days[dayOfWeek];
// }

/**
* Calculate the relative day of the month for a given date.
* E.g., 2nd Tuesday in the month corresponds to a day of the month.
* @param {Date} date - The start date.
* @return {number} The day of the month for the recurrence.
*/
// function calculateRelativeDayOfMonth(date) {
//   const dayOfWeek = date.getDay(); // 0 = Sunday, 1 = Monday, ..., 6 = Saturday
//   const dayOfMonth = date.getDate(); // The actual day in the month (e.g., 14)
//   const weekOfMonth = Math.floor((dayOfMonth - 1) / 7) + 1; // Calculate the week (e.g., 2nd)
//   const month = date.getMonth(); // Month of the start date

//   // Loop through the days of the month to find the matching relative day
//   for (let d = 1; d <= 31; d++) {
//     const testDate = new Date(date.getFullYear(), month, d);
//     if (testDate.getDay() === dayOfWeek && Math.floor((d - 1) / 7) + 1 === weekOfMonth) {
//       return d; // Return the matching day
//     }
//   }
//   throw new Error('Could not calculate relative day of the month.');
// }

/**
 * Retrieves a list of users from the 'venue users' spreadsheet.
 * Spreadsheet ID: 1588FD4pLDu33ltTPWgOscRbJHn9Q5MDTSq2aUstbjxw
 *
 * @returns {Array<object>} An array of user objects, each containing email, name, phone, tag, and JSON_value.
 */
function getUsers() {
  // Spreadsheet setup.
  const spreadsheetId = '1588FD4pLDu33ltTPWgOscRbJHn9Q5MDTSq2aUstbjxw';
  const spreadsheet = SpreadsheetApp.openById(spreadsheetId);
  const sheet = spreadsheet.getSheets()[0];

  // Get data from spreadsheet.
  const dataRange = sheet.getDataRange();
  const values = dataRange.getValues();

  // Define the column indices (this makes it clear which column we are reading)
  const COLUMN = {
    lastName: 0,
    firstName: 1,
    organisation: 2,
    email: 3,
    phone: 4,
    tag: 5,
  };

  // Process each row to create user objects.
  const users = values.slice(1).map((row) => {
    // Destructure the row into named variables.
    const [lastName, firstName, organisation, email, phone, tag] = row;

    const user = {
      email: email,
      firstName: firstName,
      name: `${firstName} ${lastName} ${organisation ? ` (${organisation})` : ''}`,
      phone: phone,
      tag: tag,
    };
    user.JSON_value = JSON.stringify(user);
    return user;
  });

  return users;
}

/**
 *  
 */
const convertFrom12To24Format = (time12) => {
  const [sHours, minutes, period] = time12.match(/([0-9]{1,2}):([0-9]{2}) (am|pm)/).slice(1);
  const PM = period === 'pm';
  const hours = (+sHours % 12) + (PM ? 12 : 0);
  return `${('0' + hours).slice(-2)}:${minutes}`;
}


/**
 *  
 */
const createDateFromTime = (day, time) => {
  return new Date(day + ":" + convertFrom12To24Format(time))
}

/**
 * Check if the attempting booking overlaps with an existing booking
 * Returns a list of clasing events
 */
function checkRoomAvailability(room, bookingDate, startTime, endTime) {
  var calendar = CalendarApp.getCalendarById(room.id);
  var clashes = [];
  var bookingStart = createDateFromTime(bookingDate, startTime);
  var bookingEnd = createDateFromTime(bookingDate, endTime);
  var events = calendar.getEventsForDay(new Date(bookingDate));
  for (var i = 0; i < events.length; i++) {
    var eventStart = events[i].getStartTime();
    var eventEnd = events[i].getEndTime();
    if (eventStart < bookingEnd && eventEnd > bookingStart) {
      clashes.push(events[i]);
    }
  }
  return clashes;
}

/**
 * Send email to user
 */
function sendEmail(form, calendar, rooms, eventId) {
  let subject = "Bluebird Booking Confirmed: Bluebird House ";
  let events;
  let user;
  if (form.Frequency != 'none') { 
    events = retrieveAllEventsInSeries(form, calendar, eventId);
  }
  const options = {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  };

  let startDate=  new Date(form.BookingDate).toLocaleDateString('en-AU', options);
  subject += startDate + " " + form.StartTime + " to " + form.EndTime;

 if (form.User && !form.User.startsWith('Casual user')) {
   user = JSON.parse(form.User);  
 } else {
    user = {
        firstName: 'Booker',
        phone: ''      
      };
 }

 const templateFile = DriveApp.getFilesByName('email_template.html').next();
 let body = templateFile.getBlob().getDataAsString();

 
  
let eventDescription;
  // let eventDescription = subject + '\n\n';
  // if (form.Message != undefined) {
  //   eventDescription += '\n\n' + form.Message + '\n\n';
  // }



  let roomText='';
  for (room of rooms) {
    roomText+= room.name;
    roomText += ',';
  }
  roomText = roomText.slice(0, -2);


  let dateText = startDate;
  if (Array.isArray(events)) {
    dateText += ' to ' + events[events.length - 1].getStartTime().toLocaleDateString('en-AU', options);
    // for (event of events) {
    //   eventDescription += '   ' + event.getStartTime().toLocaleDateString('en-AU', options);
    //   eventDescription += '\n';
    // }
  }

  let exceptionsText ='';
  if (form.Exceptions != undefined) {
    let exceptions = [form.Exceptions].flat();
    exceptionsText = ' except ';
    for (exception of exceptions) {
      exceptionsText += createDateFromddmmyyyy(exception).toLocaleDateString('en-AU', options) + ', ';
    }
    exceptionsText = exceptionsText.slice(0, -2);
  }

  const imageUrl = 'https://drive.google.com/uc?export=download&id=1GjzzO_39rYSktTjgz4YgZjGRhmAKKVYY';


  let data = {person: user.firstName,
              rooms: roomText,
              dates: dateText,
              exceptions : exceptionsText,
              message : form.Message,
              time: form.StartTime + " to " + form.EndTime,
              signatureUrl : imageUrl};

  
  body = replacePlaceholders(body, data);
  // const logoFile = DriveApp.getFilesByName('bluebird_footer.jpg').next();
  // const logoBlob = logoFile.getBlob().setName('logo');
 

  MailApp.sendEmail(
    form.Recipient,    
    subject,
    eventDescription,
    {replyTo:   Session.getActiveUser().getEmail(),
    htmlBody:  body,   
    }
  ) ;
 
}


/**
 * Returns a list of start times in 15 minute intervals as strings using am/pm notation
 */
function getStartTimes() {
  return generateTimeIntervals("", 0, 24)
}

/**
 * Returns a list of end  times in 15 minute intervals as strings using am/pm notation
 */
function getEndTimes() {
  return getTimes("", 0, 24)
}

/**
 * 
 */
function generateTimeIntervals(label, from, to) {
  const intervals = [];

  for (let hour = from; hour < 24; hour++) {
    // Generate intervals for each 15-minute segment
    for (let minute = 0; minute < 60; minute += 15) {
      // Pad hour and minute with leading zeros if needed                        
      const formattedHour = hour > 12 ? hour - 12 : (hour === 0 ? 12 : hour);
      const formattedMinute = minute.toString().padStart(2, '0');
      // Determine AM/PM
      const period = hour < 12 ? ' am' : ' pm';
      // Create time string
      const timeString = `${label}${formattedHour}:${formattedMinute}${period}`;
      intervals.push(timeString);
    }
  }
  return intervals;
}


/**
 * Set the given start time to selected
 */
function generateSelectedStartTime(startTimes, startTimeToSelect) {
  const selectedStartTime = [];
  for (const startTime of startTimes) {
    selectedStartTime.push(startTime == startTimeToSelect ? 'selected' : '');
  }
  return selectedStartTime;
}

/**
 * Retrieves room calendars that start with 'BH-G-' pattern, 
 * formats them, and returns a sorted list of room objects.
 * 
 * @return {Array} Sorted array of room objects with id, name, and JSON_value properties
 */
function getRooms() {
  const allRooms = [];
  let pageToken;

  do {
    // Fetch calendars page by page (100 at a time)
    const calendars = Calendar.CalendarList.list({
      maxResults: 100,
      pageToken: pageToken
    });

    // Check if we have any calendars
    if (!calendars.items?.length) {
      Logger.log('No calendars found.');
      return [];
    }

    // Filter and process room calendars
    const roomsFromPage = calendars.items
      .filter(calendar => calendar.summary.startsWith('BH-G-'))
      .map(calendar => {
        // Format the room name
        const name = calendar.summary
          .replace('BH-G-', '')
          .slice(0, -4); // remove the room count
        
        // Create room object with required properties
        const room = {
          id: calendar.id,
          name: name
        };        
        // Add JSON string representation
        room.JSON_value = JSON.stringify(room);        
        // Log each room
        Logger.log('%s', room.JSON_value);
        
        return room;
      });

    // Add rooms from this page to our collection
    allRooms.push(...roomsFromPage);
    
    // Get token for next page, if any
    pageToken = calendars.nextPageToken;
  } while (pageToken);

  // Sort rooms by name and return the result (forcing Other to the end)
  return allRooms.sort((a, b) => { 
   if (a.name.startsWith('Other')) {return 1; } 
   if (b.name.startsWith('Other')) {return -1;} 
   return a.name.localeCompare(b.name) 
});
  
}

function createDateFromddmmyyyy(date) {
  let d = exception.split("/");
  return new Date(d[2] + '/' + d[1] + '/' + d[0]);
}

// TODO send room id, name as json to front end
function getRoomName(rooms, id) {
  for (const room of rooms) {
   // Logger.log(room.id);
    if (room.id === id) {
      return room.summary;
    }
  }
  return null;
}

/**
 * Function to replace placeholders with actual values
 * Placeholders are in the format ${key} in the HTML template
 */
function replacePlaceholders(template, data) {

    return template.replace(/\$\{(\w+)\}/g, (match, p1) => {
      return data.hasOwnProperty(p1) ? data[p1] : match;
   });
 
}



/**

 */
function createEmailTemplate() {
  const htmlContent = `
  <!DOCTYPE html>
  <html>
    <head>
      <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; }
        .container { max-width: 600px; margin: 0 auto; }
        .header { background: #f0f0f0; padding: 10px; }
        .footer { font-size: 12px; color: #999; }
      </style>
    </head>
    <body>
      <div class="container">
       
        
        <p>Dear \${person}</p>
        
        <p>Thank you for your booking at Bluebird House:
       </p>

       <ul>
       <li>\${rooms}</li>
       <li>\${dates} \${exceptions}</li>
       <li>\${time}</li>
       </ul>

       <div class="header">\${message}</div>
        
        <p>We look forward to seeing you at Bluebird House</p>

        <p><b>Sarah Moore</b> (she/her)<br>
        Bluebird House - Venue Operations Coordinator<br> 
        Bluebird Foundation Inc.<br>
        Phone: 03 5202 4870<br>
        Part-time: Monday and Wednesday<br>
        Mobile: 0403 012 829 </p>

        <img src="\${signatureUrl}" alt="Bluebird" height="200" width="500"/>       
        
        
      </div>
    </body>
  </html>`;

   // Create the template file in Google Drive
  DriveApp.createFile('email_template.html', htmlContent, MimeType.HTML);
  
  return htmlContent;
}