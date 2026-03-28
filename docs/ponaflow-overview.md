# ponaflow

ponaflow is a minimalist web client/API orchestration engine for multi-step workflows served as a github repo template. It relies on one central configuration file and an regulated directory structure. 

# Key features

## Atomic Elements
### Project: A project is the top level atomic element, and each repo can have only one project.
A project contains:
- A name: A unique identifier for the project
- A landing page: An address for the HTML page to load (must be contained within the project's 'page' array)
- A webhook URL: An API endpoint
- A domain (optional): A domain that, once the project is deployed, will forward to the associated landing page
- A page array: A project can contain multiple pages
- An action element array: A project can contain multiple action elements
### Pages:
Each page contains:
- A slug: A slug identifying the page
- An HTML address: (located within the project/project-code/html folder )
- A submission package JSON: A path to a JSON representing the data that gets sent to the project endpoint when the page loads. Values for the submission package accept the values specified by URL parameters in priority, overriding any values specified directly in the JSON.
- A response schema JSON: A path to a JSON respresenting the data that the page expects as a response from the endpoint, a boolean representing whether or not the response is required for the page's HTML, CSS, and JS to be loaded, and the corresponding error message if the required response fails to be returned. 
### Action elements: An action element is an element within a page that interacts with the project endpoint (ie. form, button, or link)
- An ID: A unique identifier
- A boolean 'Immediate' status: This status is primarily used for form-based action elements and defaults to true if unspecified. If false, it means that the action element is a form and it must wait until the associated submission button is clicked before posting all the input fields in a batch. If the action element is a form and the immediate property is unspecified (ie. true), then all inputs are posted individually once captured.
- A destination: An address for the HTML page to forward to once the action is taken
- A submission package: A path to a JSON representing the data that gets sent to the project endpoint when the action is taken. Values for the submission package accept the values specified by URL parameters in priority, overriding any values specified directly in the JSON.
- A response schema: A path to a JSON respresenting the data that the action element expects as a response from the endpoint, a boolean representing whether or not the response is required for the action to be taken, and the corresponding error message if the required response fails to be returned. 

## Attribute handling
### Action element attributes
Action elements are inserted into the page using the HTML attribute action-element-id. Examples:
  <!-- Form -->
  <form action-element-id="contact-form">
    <label for="name">Name:</label>
    <input type="text" id="name" name="name">
    <button type="submit">Submit</button>
  </form>

  ^ Note that for the form implementation the traditional 'action' and 'method' attributes, as well as a traditional 'type' attribute for the submit button, are not required.

  <!-- Button -->
  <button action-element-id="go-back">Go Back</button> 

  <!-- Link -->
  <a action-element-id="go-back">Go Back</a>

  ^ Notice that for buttons and links, the traditional 'type' and 'href' attributes are not required.

### Variable insertion attributes
In order to display values returned from the endpoint specified within a pages' response schema or otherwise returned by the endpoint, an insertion attribute, 'key', is used. 
Example:
Let's say that the page receives this response from the endpoint:
{
  "page": {
    "titles": {
      "title_A": "Welcome",
      "title_B": "Getting Started"
    },
    "body": "This page contains introductory content.",
    "image":"/assets/sample.jpeg",
    "video":"/assets/sample.mp4"
  }
}

These variables may be inserted like:

<span key="page.titles.title_a"></span>

<h1 key="page.titles.title_a"></h1>

<img key="page.image"></img>

<video controls width="640">
  <source key="page.video" type="video/mp4">
</video>

^ Notice that for images and video the key attribute replaces the traditional 'src' attribute and may point to a file hosted within the project or an external source.

<ol key="page.titles">

<ul key="page.titles">

^ Any key that returns an array of items can be interpreted as a list


## Submission packages
Both pages and action elements have optional associated JSON files refered to as submission packages. A submission package is a free-form JSON file that gets passed along to the project's webhook endpoint before a page loads or upon interaction with an action element.

Example:
If the /getting-started page was associated with a submission package like this:
{
  "page": {
    "titles": {
      "title_A": "Welcome",
      "title_B": "Getting Started"
    },
    "body": "This page contains introductory content."
  }
}

That information in the page's submission package could be overridden by entering URL parameters like this:
[domain or localhost]/getting-started?page.titles.title_A=Hello&page.titles.title_B=Overview&page.body=This%20is%20the%20body%20text%20that%20overrides%20the%20default%20value.

And new values could be entered into the page's submission package like this:
[domain or localhost]/getting-started?page.titles.title_C=This%20is%20a%20third%20title

^ This only works for page submission packages, not action element submission packages.

Note: When an action element has an 'immediate' status of false, it's assumed that it is a form-based action and that upon submission of the form all inputs are included within the action element's submission package.

## Response packages
Both pages and action elements have optional associated JSON files referred to as response packages. A response package is a free-form JSON file that interprets the response from the endpoint before the page loads or after interaction with an action element. 

For pages, the response package does three things:
1) Defines an optional default value to be used in the case that the endpoint fails to return a matching key:value pair
2) Defines a 'required' status that determines if the value is necessary in order for the page to begin loading (set to false if unspecified)
3) Defines an error message to display if the value is marked as required and was not received. To display the error the user can use an attribute 

Example: 
{
  "titles.title_A": {
    "required":true,
    "error": "The endpoint failed to provide a value for title_A",
  },
  "titles.title_B": {
    "default": "Getting Started",
  },
  "body": {
    "default": "This page contains introductory content.",
  }
}

If the response package of either a page or an action element returns an error, the error text can be displayed through variable attributes as described above (ie. <span class="error-message" key="titles.title_A.error">). If the response package for both the page and the action element return identical structures, default to the action element's value.


## The Builder
The builder is a simple front-end interface for configuring the main config file. It takes the form of a nested form representing the state of the config and can be run locally using the '/build' command. It runs a validation script in the backend that checks for any potentially breaking changes (for example, conflicting IDs) and displays any relevant project error messages.  